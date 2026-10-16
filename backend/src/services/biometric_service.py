"""Business layer for eBioServerNew integration.

The eBioServer SOAP contract is kept separate from application/UI concepts.
Only documented SOAP operations are called from this service.
"""
from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import func

from src.models.biometric import BiometricLog
from src.models.biometric_device import BiometricDevice
from src.models.customer import Customer
from src.services.essl_bioserver_client import (
    essl_client,
    EsslConnectionError,
    EsslSoapError,
)

logger = logging.getLogger("biometric_service")
DUPLICATE_WINDOW_SECONDS = 30


def _now() -> dt.datetime:
    try:
        from src.utils.timezone import now_ist_naive
        return now_ist_naive()
    except Exception:
        return dt.datetime.now()


def _parse_vendor_time(value: str) -> dt.datetime:
    value = (value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return dt.datetime.strptime(value, fmt)
        except ValueError:
            pass
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        raise ValueError(f"Invalid eBioServer LogDate '{value}'")


def _verification_to_event_type(value: str) -> str:
    v = (value or "").strip().lower()
    if "face" in v and "fingerprint" in v:
        return "FACE_FINGERPRINT"
    if "face" in v:
        return "FACE_SCAN"
    if "fingerprint" in v or "finger" in v:
        return "FINGERPRINT"
    if "card" in v:
        return "RFID_CARD"
    if "password" in v:
        return "PASSWORD"
    if "palm" in v:
        return "PALM_PRINT"
    return "BIOMETRIC"


def _direction(value: str) -> str:
    v = (value or "").strip().upper()
    if v in {"IN", "CHECK_IN", "0"}:
        return "CHECK_IN"
    if v in {"OUT", "CHECK_OUT", "1"}:
        return "CHECK_OUT"
    raise ValueError(f"Unsupported eBioServer Direction '{value}'")


def _first_device_by_serial(db: Session, serial: str) -> Optional[BiometricDevice]:
    if not serial:
        return None
    return db.query(BiometricDevice).filter(BiometricDevice.serial_number == serial).first()


def _resolve_customer(db: Session, employee_code: str) -> Optional[Customer]:
    # The supplied eBioServer webhook manual gives EmployeeCode, but it does
    # not define how that value maps to the application's Customer table.
    # First try the application's primary key; deployments with a dedicated
    # employee-code column can add that mapping here without changing the
    # vendor contract.
    return db.query(Customer).filter(Customer.id == employee_code).first()


def _is_physical_log(log: BiometricLog) -> bool:
    dev_type = str(log.device_type or "").upper()
    dev_id = str(log.device_id or "")
    event_type = str(log.event_type or "").upper()
    meta = log.meta_data or {}
    method = str(meta.get("method", "")).upper()
    channel = str(meta.get("verification_channel", "")).upper()
    punch_mode = str(meta.get("punch_mode", "")).upper()

    if dev_type in ["GEOFENCE_ESS", "AI_FACE_PORTAL", "MOBILE_GPS", "MANUAL_WEB"]:
        return False
    if dev_id == "ess_geofence_portal" or method == "GPS_GEOFENCE" or punch_mode == "GPS":
        return False
    if channel in ["CUSTOMER_MOBILE_WEB_PORTAL", "STAFF_PORTAL", "MANUAL_GPS"]:
        return False
    if event_type in ["GPS_SCAN"]:
        return False
    return True


class BiometricService:
    # --------------------------- local reporting ---------------------------
    @staticmethod
    def get_recent_checkins(db: Session, limit: int = 100, role_filter: Optional[str] = None, physical_only: bool = False) -> List[Dict[str, Any]]:
        query = db.query(BiometricLog)

        if physical_only:
            query = query.filter(
                BiometricLog.device_type != "GEOFENCE_ESS",
                BiometricLog.event_type != "GPS_SCAN",
            )

        if role_filter and str(role_filter).strip().upper() not in ["ALL", ""]:
            rf = str(role_filter).strip().upper()
            if rf in ["CUSTOMER", "CUSTOMERS"]:
                query = query.filter(BiometricLog.user_role == "CUSTOMER")
            elif rf in ["TRAINER", "STAFF", "TRAINERS", "TRAINER_STAFF", "EMPLOYEE", "STAFF_TRAINER"]:
                query = query.filter(BiometricLog.user_role.in_(["TRAINER", "STAFF", "GYM_OWNER", "MANAGER"]))

        fetch_limit = limit * 3 if physical_only else limit
        logs = query.order_by(BiometricLog.timestamp.desc()).limit(fetch_limit).all()

        if physical_only:
            logs = [l for l in logs if _is_physical_log(l)][:limit]

        customer_ids = {x.customer_id for x in logs if x.customer_id}
        customers = {}
        if customer_ids:
            found_custs = db.query(Customer).filter(
                (Customer.id.in_(customer_ids)) | (Customer.user_id.in_(customer_ids))
            ).all()
            for c in found_custs:
                customers[c.id] = c
                if c.user_id:
                    customers[c.user_id] = c

        from src.models.user import User
        users = {
            u.id: u
            for u in (db.query(User).filter(User.id.in_(customer_ids)).all() if customer_ids else [])
        }

        from src.models.hrms import Employee
        from src.models.trainer import TrainerProfile
        trainers = {
            t.id: t
            for t in (db.query(TrainerProfile).filter(TrainerProfile.id.in_(customer_ids)).all() if customer_ids else [])
        }
        employees = {
            e.id: e
            for e in (db.query(Employee).filter(Employee.id.in_(customer_ids)).all() if customer_ids else [])
        }

        # Query membership records for found customers
        memberships_by_cust = {}
        if customers:
            try:
                from src.models.membership import Membership
                all_cids = list({c.id for c in customers.values()})
                mems = db.query(Membership).filter(
                    Membership.customer_id.in_(all_cids)
                ).order_by(Membership.created_at.desc()).all()
                for m in mems:
                    if m.customer_id not in memberships_by_cust:
                        memberships_by_cust[m.customer_id] = m
            except Exception as e:
                logger.warning(f"Error querying customer memberships in biometric service: {e}")

        # Query total visits (check-ins) count
        visit_counts = {}
        if customers:
            try:
                from sqlalchemy import func
                all_cids = list({c.id for c in customers.values()})
                counts = (
                    db.query(BiometricLog.customer_id, func.count(BiometricLog.id))
                    .filter(BiometricLog.customer_id.in_(all_cids), BiometricLog.direction == "CHECK_IN")
                    .group_by(BiometricLog.customer_id)
                    .all()
                )
                for cid, cnt in counts:
                    visit_counts[cid] = cnt
            except Exception as e:
                logger.warning(f"Error counting customer visits in biometric service: {e}")

        result = []
        for log in logs:
            meta = log.meta_data or {}
            raw_role = (log.user_role or meta.get("user_role") or "CUSTOMER").upper()

            cust = customers.get(log.customer_id)
            if not cust and log.customer_id in users:
                user_obj = users.get(log.customer_id)
                for c in customers.values():
                    if c.user_id == user_obj.id:
                        cust = c
                        break

            trainer_obj = trainers.get(log.customer_id)
            emp_obj = employees.get(log.customer_id)
            user_obj = users.get(log.customer_id)

            resolved_name = (
                meta.get("customer_name")
                or (cust.full_name if cust else None)
                or meta.get("employee_name")
                or meta.get("user_name")
                or (trainer_obj.full_name if trainer_obj else None)
                or (user_obj.full_name if user_obj else None)
                or (f"{emp_obj.first_name} {emp_obj.last_name or ''}".strip() if emp_obj else None)
                or (f"Member ({log.customer_id[:6]})" if log.customer_id else "Gym Member")
            )

            # Profile photo resolution
            avatar = (
                (cust.profile_image if cust and cust.profile_image else None)
                or meta.get("avatar")
                or meta.get("profile_image")
                or (trainer_obj.profile_image if trainer_obj and trainer_obj.profile_image else None)
            )

            # Phone & Email resolution
            phone = (
                (cust.phone if cust and cust.phone else None)
                or meta.get("phone")
                or (trainer_obj.phone if trainer_obj and trainer_obj.phone else None)
                or (emp_obj.phone if emp_obj and emp_obj.phone else None)
            )
            email = (
                (cust.email if cust and cust.email else None)
                or meta.get("email")
                or (trainer_obj.email if trainer_obj and trainer_obj.email else None)
                or (emp_obj.email if emp_obj and emp_obj.email else None)
                or (user_obj.email if user_obj and user_obj.email else None)
            )

            # Membership resolution
            mem = memberships_by_cust.get(cust.id) if cust else (memberships_by_cust.get(log.customer_id) if log.customer_id in memberships_by_cust else None)
            mem_plan = "Standard Membership"
            mem_status = "Active"
            mem_expiry = None
            due_amount = 0.0

            if mem:
                mem_plan = mem.plan_name or mem.plan_type or "Premium Plan"
                mem_status = (mem.status or "Active").upper()
                due_amount = float(mem.due_amount or 0.0)
                if mem.expiry_date:
                    mem_expiry = mem.expiry_date.strftime("%d %b %Y")
            elif raw_role != "CUSTOMER":
                mem_plan = "Staff / Trainer"
                mem_status = "ACTIVE"
            elif cust and cust.status:
                mem_status = cust.status.upper()

            total_visits = (visit_counts.get(cust.id) if cust else None) or visit_counts.get(log.customer_id) or 1

            # Confidence score formatting
            raw_conf = log.confidence_score
            if raw_conf is None:
                raw_conf = 0.985 if log.event_type in ["FACE_SCAN", "FACE_RECOGNITION"] else 1.0

            result.append({
                "id": log.id,
                "customer_id": (cust.id if cust else log.customer_id) or "",
                "customer_name": resolved_name,
                "person_name": resolved_name,
                "user_role": raw_role,
                "avatar": avatar,
                "phone": phone,
                "email": email,
                "gender": cust.gender if cust else None,
                "age": cust.age if cust else None,
                "weight": cust.weight if cust else None,
                "height": cust.height if cust else None,
                "bmi": cust.bmi if cust else None,
                "goal": cust.goal if (cust and cust.goal) else (meta.get("goal") or "General Fitness"),
                "fitness_level": cust.fitness_level if (cust and cust.fitness_level) else "Active Member",
                "membership_plan": mem_plan,
                "membership_status": mem_status,
                "membership_expiry": mem_expiry,
                "due_amount": due_amount,
                "total_visits": total_visits,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "event_type": log.event_type or "FACE_SCAN",
                "device_id": log.device_id,
                "device_name": log.device_name or meta.get("branch") or "Mobile Face Scanner",
                "device_type": log.device_type,
                "direction": log.direction or "CHECK_IN",
                "status": log.status or "SUCCESS",
                "confidence_score": round(float(raw_conf), 4),
                "confidence_percentage": f"{round(float(raw_conf) * 100, 1)}%",
                "branch": (cust.primary_gym_location if cust and cust.primary_gym_location else None) or meta.get("branch") or log.device_name or "Main Branch",
                "notes": meta.get("note") or meta.get("notes") or f"Marked via {log.event_type or 'Mobile'}",
                "meta_data": log.meta_data,
            })
        return result

    @staticmethod
    def get_latest_customer_punch(db: Session, since_timestamp: Optional[str] = None) -> Dict[str, Any]:
        """Returns the most recent customer punch, optionally strictly after since_timestamp."""
        query = db.query(BiometricLog).filter(BiometricLog.user_role == "CUSTOMER")

        if since_timestamp:
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(since_timestamp.replace("Z", "+00:00"))
                query = query.filter(BiometricLog.timestamp > dt)
            except Exception:
                pass

        log = query.order_by(BiometricLog.timestamp.desc()).first()
        if not log:
            return {"has_new": False, "punch": None}

        # Format using get_recent_checkins
        enriched = BiometricService.get_recent_checkins(db, limit=1, role_filter="CUSTOMER")
        match = next((item for item in enriched if item.get("id") == log.id), None)
        return {
            "has_new": True if match else False,
            "punch": match
        }

    @staticmethod
    def get_attendance_analytics(db: Session, role_filter: Optional[str] = None, physical_only: bool = False) -> Dict[str, Any]:
        try:
            from src.utils.timezone import today_ist_start
            today_start = today_ist_start()
        except Exception:
            now = _now()
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        query = db.query(BiometricLog).filter(BiometricLog.timestamp >= today_start)
        if physical_only:
            query = query.filter(
                BiometricLog.device_type != "GEOFENCE_ESS",
                BiometricLog.event_type != "GPS_SCAN",
            )

        if role_filter and str(role_filter).strip().upper() not in ["ALL", ""]:
            rf = str(role_filter).strip().upper()
            if rf in ["CUSTOMER", "CUSTOMERS"]:
                query = query.filter(BiometricLog.user_role == "CUSTOMER")
            elif rf in ["TRAINER", "STAFF", "TRAINERS", "TRAINER_STAFF", "EMPLOYEE", "STAFF_TRAINER"]:
                query = query.filter(BiometricLog.user_role.in_(["TRAINER", "STAFF", "GYM_OWNER", "MANAGER"]))

        all_today_logs = query.all()
        if physical_only:
            logs = [x for x in all_today_logs if _is_physical_log(x)]
        else:
            logs = all_today_logs

        checkins = [x for x in logs if x.direction == "CHECK_IN"]
        hour_counts = [0] * 24
        for item in checkins:
            if item.timestamp:
                hour_counts[item.timestamp.hour] += 1
        peak = max(range(24), key=lambda h: hour_counts[h]) if any(hour_counts) else None

        week_start = today_start - dt.timedelta(days=6)
        week_query = db.query(BiometricLog).filter(
            BiometricLog.timestamp >= week_start,
            BiometricLog.timestamp < today_start + dt.timedelta(days=1),
            BiometricLog.direction == "CHECK_IN",
        )
        if physical_only:
            week_query = week_query.filter(
                BiometricLog.device_type != "GEOFENCE_ESS",
                BiometricLog.event_type != "GPS_SCAN",
            )
        if role_filter and str(role_filter).strip().upper() not in ["ALL", ""]:
            rf = str(role_filter).strip().upper()
            if rf in ["CUSTOMER", "CUSTOMERS"]:
                week_query = week_query.filter(BiometricLog.user_role == "CUSTOMER")
            elif rf in ["TRAINER", "STAFF", "TRAINERS", "TRAINER_STAFF", "EMPLOYEE", "STAFF_TRAINER"]:
                week_query = week_query.filter(BiometricLog.user_role.in_(["TRAINER", "STAFF", "GYM_OWNER", "MANAGER"]))

        week_all_logs = week_query.all()
        if physical_only:
            week_logs = [x for x in week_all_logs if _is_physical_log(x)]
        else:
            week_logs = week_all_logs

        counts_by_date = {}
        for wl in week_logs:
            if wl.timestamp:
                d_str = wl.timestamp.date().isoformat()
                counts_by_date[d_str] = counts_by_date.get(d_str, 0) + 1

        weekly = []
        weekly_labels = []
        weekly_data = []
        for offset in range(6, -1, -1):
            day = (today_start - dt.timedelta(days=offset)).date()
            c = counts_by_date.get(day.isoformat(), 0)
            weekly.append({
                "date": day.isoformat(),
                "label": day.strftime("%a"),
                "count": c,
            })
            weekly_labels.append(day.strftime("%a"))
            weekly_data.append(c)

        granted_count = len([x for x in logs if (x.status or "").strip().upper() in {"SUCCESS", "GRANTED"}])
        denied_count = len([x for x in logs if (x.status or "").strip().upper() in {"DENIED", "FAILED"}])
        total_events = len(logs)
        success_rate = round((granted_count / total_events * 100), 1) if total_events > 0 else 0.0

        customer_count = len([x for x in checkins if (x.user_role or "").upper() == "CUSTOMER"])
        staff_count = len([x for x in checkins if (x.user_role or "").upper() in ["TRAINER", "STAFF", "GYM_OWNER", "MANAGER"]])

        return {
            "today_checkins": len(checkins),
            "customer_checkins": customer_count,
            "staff_checkins": staff_count,
            "today_events": total_events,
            "today_granted": granted_count,
            "today_denied": denied_count,
            "today_success_rate": success_rate,
            "peak_hour": f"{peak:02d}:00" if peak is not None else "No check-ins yet",
            "avg_duration": "1h 15m" if len(checkins) > 0 else "—",
            "hourly_data": hour_counts,
            "hourly_labels": [f"{h:02d}:00" for h in range(24)],
            "weekly_trend": weekly,
            "weekly_data": weekly_data,
            "weekly_labels": weekly_labels,
            "recent_checkins": BiometricService.get_recent_checkins(db, 50, role_filter=role_filter, physical_only=physical_only),
        }

    @staticmethod
    def _is_duplicate(db: Session, customer_id: Optional[str], device_id: str,
                      direction: str, event_time: dt.datetime) -> Optional[BiometricLog]:
        if not customer_id:
            return None
        cutoff = event_time - dt.timedelta(seconds=DUPLICATE_WINDOW_SECONDS)
        return (
            db.query(BiometricLog)
            .filter(
                BiometricLog.customer_id == customer_id,
                BiometricLog.device_id == device_id,
                BiometricLog.direction == direction,
                BiometricLog.timestamp >= cutoff,
                BiometricLog.timestamp <= event_time + dt.timedelta(seconds=DUPLICATE_WINDOW_SECONDS),
            )
            .first()
        )

    @staticmethod
    def record_checkin(
        db: Session,
        customer_id: Optional[str],
        event_type: str,
        device_id: str,
        direction: str,
        status: str = "SUCCESS",
        confidence_score: Optional[float] = None,
        event_time: Optional[dt.datetime] = None,
        meta_data: Optional[Dict[str, Any]] = None,
    ) -> BiometricLog:
        if direction not in {"CHECK_IN", "CHECK_OUT", "ENROLL"}:
            raise ValueError(f"Invalid direction '{direction}'")
        timestamp = event_time or _now()

        duplicate = BiometricService._is_duplicate(db, customer_id, device_id, direction, timestamp)
        if duplicate:
            return duplicate

        device = db.query(BiometricDevice).filter(BiometricDevice.id == device_id).first()
        device_name = getattr(device, "device_name", None) or device_id
        device_type = getattr(device, "model_name", None) or "eSSL Biometric Terminal"

        log = BiometricLog(
            id=f"bio_{uuid.uuid4().hex}",
            customer_id=customer_id,
            user_role="CUSTOMER" if customer_id else "UNKNOWN",
            event_type=event_type,
            device_id=device_id,
            device_name=device_name,
            device_type=device_type,
            direction=direction,
            status=status,
            confidence_score=confidence_score,
            meta_data=meta_data or {},
            timestamp=timestamp,
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        return log

    @staticmethod
    def register_device(db: Session, device_data: Dict[str, Any]) -> BiometricDevice:
        """Create or update a locally registered biometric device."""
        device_id = (device_data.get("id") or device_data.get("external_device_id") or
                     device_data.get("serial_number") or f"DEV_{uuid.uuid4().hex[:12]}")
        existing = db.query(BiometricDevice).filter(BiometricDevice.id == device_id).first()
        if not existing and device_data.get("serial_number"):
            existing = _first_device_by_serial(db, device_data["serial_number"])

        allowed = {
            "external_device_id", "serial_number", "device_name", "model_name",
            "ip_address", "port", "device_type", "connection_type", "mac_address",
            "wifi_ssid", "is_wireless", "status", "location"
        }
        values = {k: v for k, v in device_data.items() if k in allowed and v is not None}
        if not values.get("device_name"):
            raise ValueError("device_name is required")
        if existing:
            for key, value in values.items():
                setattr(existing, key, value)
            db.commit()
            db.refresh(existing)
            return existing

        device = BiometricDevice(id=device_id, **values)
        db.add(device)
        db.commit()
        db.refresh(device)
        return device

    # --------------------------- eBioServer sync ---------------------------
    @staticmethod
    def sync_devices_from_ebioserver(db: Session, location: str = "") -> Dict[str, Any]:
        raw = essl_client.get_device_list(location)
        parsed = essl_client.parse_device_list_result(raw)
        synced = []

        for item in parsed:
            serial = item.get("SerialNumber") or item.get("DeviceSerialNumber") or item.get("serial_number")
            external_id = item.get("DeviceID") or item.get("external_device_id") or serial
            if not external_id and not serial:
                continue

            db_device = None
            if external_id:
                db_device = db.query(BiometricDevice).filter(BiometricDevice.id == external_id).first()
            if not db_device and serial:
                db_device = _first_device_by_serial(db, serial)

            values = {
                "external_device_id": external_id,
                "serial_number": serial,
                "device_name": item.get("DeviceName") or item.get("Alias") or serial or external_id,
                "model_name": item.get("Model") or item.get("DeviceType") or "eSSL",
                "ip_address": item.get("IPAddress") or item.get("IP"),
                "port": int(item["Port"]) if str(item.get("Port", "")).isdigit() else None,
                "device_type": item.get("DeviceType") or "BIOMETRIC",
                "status": item.get("Status") or item.get("IsOnline") or "UNKNOWN",
                "location": item.get("Location") or item.get("Area") or location,
            }

            if db_device:
                for key, value in values.items():
                    if value not in (None, ""):
                        setattr(db_device, key, value)
                if hasattr(db_device, "last_sync_at"):
                    db_device.last_sync_at = _now()
            else:
                db_device = BiometricDevice(id=external_id or serial, **values)
                if hasattr(db_device, "last_sync_at"):
                    db_device.last_sync_at = _now()
                db.add(db_device)
            synced.append({"id": db_device.id, **values})

        db.commit()
        return {"status": "OK", "source": "EBIOSERVER", "location": location, "count": len(synced), "devices": synced, "raw": raw}

    @staticmethod
    def get_all_devices(db: Session, location: str = "") -> Dict[str, Any]:
        live_error = None
        live = None
        if essl_client.is_configured:
            try:
                live = BiometricService.sync_devices_from_ebioserver(db, location)
            except (EsslConnectionError, EsslSoapError) as exc:
                live_error = str(exc)
                db.rollback()
                logger.warning("eBioServer device sync failed: %s", exc)

        devices = db.query(BiometricDevice).order_by(BiometricDevice.created_at.desc()).all()
        return {
            "status": "OK",
            "sync_status": "LIVE" if live is not None else ("LIVE_SYNC_FAILED" if live_error else "LOCAL"),
            "sync_error": live_error,
            "devices": [
                {
                    "id": d.id,
                    "external_device_id": getattr(d, "external_device_id", None),
                    "serial_number": getattr(d, "serial_number", None),
                    "device_name": getattr(d, "device_name", None),
                    "model_name": getattr(d, "model_name", None),
                    "device_type": getattr(d, "device_type", None),
                    "ip_address": getattr(d, "ip_address", None),
                    "port": getattr(d, "port", None),
                    "status": getattr(d, "status", None),
                    "location": getattr(d, "location", None),
                    "connection_type": getattr(d, "connection_type", None),
                }
                for d in devices
            ],
        }

    # --------------------------- documented operations ---------------------------
    @staticmethod
    def call_update_employee(payload: Dict[str, Any]) -> str:
        return essl_client.update_employee(
            payload["EmployeeCode"], payload["EmployeeName"], payload.get("EmployeeLocation", ""),
            payload.get("EmployeeRole", "Normal"), payload.get("EmployeeVerificationType", ""),
        )

    @staticmethod
    def call_update_employee_expiry(payload: Dict[str, Any]) -> str:
        return essl_client.update_employee_with_expiry_dates(
            payload["EmployeeCode"], payload["EmployeeName"], payload.get("EmployeeLocation", ""),
            payload.get("EmployeeRole", "Normal"), payload.get("EmployeeVerificationType", ""),
            payload.get("EmployeeExpiryFrom", ""), payload.get("EmployeeExpiryTo", ""),
        )

    @staticmethod
    def call_update_employee_photo(payload: Dict[str, Any]) -> str:
        return essl_client.update_employee_photo(payload["EmployeeCode"], payload["EmployeePhoto"])

    @staticmethod
    def call_update_employee_ex(payload: Dict[str, Any]) -> str:
        return essl_client.update_employee_ex(
            payload["EmployeeCode"], payload["EmployeeName"], payload.get("EmployeeLocation", ""),
            payload.get("EmployeeRole", "Normal"), payload.get("EmployeeVerificationType", ""),
            payload.get("EmployeeExpiryFrom", ""), payload.get("EmployeeExpiryTo", ""),
            payload.get("EmployeeCardNumber", ""), payload.get("GroupId", ""), payload.get("EmployeePhoto", ""),
        )

    @staticmethod
    def process_webhook(db: Session, payload: Dict[str, Any]) -> Dict[str, Any]:
        employee_code = str(payload.get("EmployeeCode", "")).strip()
        serial = str(payload.get("SerialNumber", "")).strip()
        if not employee_code:
            raise ValueError("EmployeeCode is required")
        if not serial:
            raise ValueError("SerialNumber is required")
        if not payload.get("LogDate"):
            raise ValueError("LogDate is required")
        if not payload.get("Direction"):
            raise ValueError("Direction is required")

        device = _first_device_by_serial(db, serial)
        if not device:
            # Webhook itself is authoritative enough to create the device
            # identity, but not enough to invent model/network details.
            device = BiometricDevice(
                id=f"essl_{serial}",
                external_device_id=serial,
                serial_number=serial,
                device_name=payload.get("DeviceName") or serial,
                model_name="eSSL",
                device_type="BIOMETRIC",
                status="ONLINE",
                location=payload.get("DeviceDirection") or "",
            )
            db.add(device)
            db.commit()
            db.refresh(device)

        event_time = _parse_vendor_time(payload["LogDate"])
        direction = _direction(payload["Direction"])
        customer = _resolve_customer(db, employee_code)
        event_type = _verification_to_event_type(payload.get("VerificationType", ""))

        meta = {
            "source": "EBIOSERVER_WEBHOOK",
            "EmployeeCode": employee_code,
            "DownloadDate": payload.get("DownloadDate"),
            "LogDate": payload.get("LogDate"),
            "DeviceName": payload.get("DeviceName"),
            "SerialNumber": serial,
            "Direction": payload.get("Direction"),
            "DeviceDirection": payload.get("DeviceDirection"),
            "WorkCode": payload.get("WorkCode"),
            "VerificationType": payload.get("VerificationType"),
            "GPS": payload.get("GPS"),
        }
        customer_id = customer.id if customer else None
        existing = BiometricService._is_duplicate(db, customer_id, device.id, direction, event_time)
        if existing:
            log = existing
            outcome = "DUPLICATE"
        else:
            log = BiometricService.record_checkin(
                db=db,
                customer_id=customer_id,
                event_type=event_type,
                device_id=device.id,
                direction=direction,
                status="SUCCESS",
                event_time=event_time,
                meta_data=meta,
            )
            outcome = "SYNCED"
        return {
            "status": "OK",
            "message": "eSSL Web Hook Record Synced",
            "log_id": log.id,
            "duplicate_or_new": outcome,
            "employee_code": employee_code,
            "serial_number": serial,
            "direction": direction,
            "event_type": event_type,
        }
