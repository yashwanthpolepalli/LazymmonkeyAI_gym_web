from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.database.session import get_db
from src.services.inventory_service import InventoryService
from src.services.image_search_service import ImageSearchService
from src.utils.ai_image_control import is_ai_image_search_paused, set_ai_image_search_paused

router = APIRouter(prefix="/inventory", tags=["Inventory"])


@router.get("", response_model=List[Dict[str, Any]])
def get_inventory(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    brand: Optional[str] = Query(None),
    unit: Optional[str] = Query(None),
    stock_status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List all gym inventory products with stock levels, filters, and pricing."""
    return InventoryService.get_inventory_items(
        db=db,
        search=search,
        category=category,
        brand=brand,
        unit=unit,
        stock_status=stock_status
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Create a new product in gym inventory."""
    return InventoryService.create_inventory_item(db=db, data=payload)


@router.get("/overview")
def get_inventory_overview(db: Session = Depends(get_db)):
    """Get high-level inventory metrics: total value, stock counts, category splits."""
    return InventoryService.get_inventory_overview(db=db)


@router.get("/master-catalog")
def get_master_catalog(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    brand: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List products from the global master catalog ready to be imported."""
    return InventoryService.get_master_catalog_items(
        db=db,
        search=search,
        category=category,
        brand=brand
    )


@router.post("/master-catalog/import")
def import_master_catalog(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Import items from Master Catalog into active gym inventory."""
    return InventoryService.import_from_master_catalog(db=db, payload=payload)


@router.get("/master-catalog/ai-image-search/status")
def get_ai_image_search_status():
    """Get status of AI Image search and generation."""
    paused = is_ai_image_search_paused()
    return {"paused": paused, "status": "paused" if paused else "active"}


@router.post("/master-catalog/ai-image-search/pause")
def pause_ai_image_search():
    """Pause AI Image search globally."""
    set_ai_image_search_paused(True)
    return {"paused": True, "message": "AI image search and generation paused successfully."}


@router.post("/master-catalog/ai-image-search/resume")
def resume_ai_image_search(db: Session = Depends(get_db)):
    """Resume AI Image search globally and enrich pending catalog items."""
    set_ai_image_search_paused(False)
    enriched = ImageSearchService.enrich_pending_products(db=db, limit=10)
    return {
        "paused": False,
        "enriched_count": enriched,
        "message": f"AI image search resumed successfully. Enriched {enriched} products with dynamic visuals."
    }


@router.post("/products/{product_id}/fetch-image")
def fetch_single_product_image(
    product_id: str,
    db: Session = Depends(get_db)
):
    """Dynamically search and assign image to a product from AI / web."""
    img_url = ImageSearchService.enrich_single_product(db=db, product_id=product_id)
    if img_url:
        return {"success": True, "image_url": img_url, "message": "Image dynamically discovered and updated"}
    return {"success": False, "image_url": "", "message": "No suitable dynamic image found"}


@router.post("/products/enrich-pending")
def enrich_pending_products(db: Session = Depends(get_db)):
    """Trigger dynamic AI background visual enrichment for products lacking images."""
    count = ImageSearchService.enrich_pending_products(db=db, limit=10)
    return {"success": True, "enriched_count": count, "message": f"Dynamically generated graphics for {count} products"}


@router.post("/adjust-stock")
def adjust_stock(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Perform a Stock In, Stock Out, or manual stock level adjustment."""
    try:
        return InventoryService.adjust_stock(db=db, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/stock-movements")
def get_stock_movements(
    product_id: Optional[str] = Query(None),
    limit: int = Query(50),
    db: Session = Depends(get_db)
):
    """Get stock movement audit history logs."""
    return InventoryService.get_stock_movements(db=db, product_id=product_id, limit=limit)


@router.post("/bulk-delete")
def bulk_delete_products(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Bulk delete products from gym inventory."""
    product_ids = payload.get("product_ids", [])
    return InventoryService.bulk_delete_items(db=db, product_ids=product_ids)


@router.post("/bulk-sync-pos")
def bulk_sync_to_pos(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Import and synchronize selected products to the POS terminal."""
    product_ids = payload.get("product_ids", [])
    sync_status = payload.get("sync_status", True)
    return InventoryService.bulk_sync_to_pos(db=db, product_ids=product_ids, sync_status=sync_status)


@router.post("/{item_id}/toggle-pos")
def toggle_single_pos_sync(
    item_id: str,
    db: Session = Depends(get_db)
):
    """Toggle POS terminal synchronization for a single product."""
    try:
        return InventoryService.toggle_pos_sync(db=db, product_id=item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/bulk-generate-barcodes")
def bulk_generate_barcodes(
    payload: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db)
):
    """Bulk generate scannable barcodes for items missing one."""
    barcode_type = payload.get("barcode_type", "EAN-13") if payload else "EAN-13"
    return InventoryService.bulk_generate_barcodes(db=db, barcode_type=barcode_type)


@router.post("/{item_id}/generate-barcode")
def generate_single_barcode(
    item_id: str,
    payload: Optional[Dict[str, Any]] = None,
    db: Session = Depends(get_db)
):
    """Generate scannable barcode for a single product."""
    try:
        barcode_type = payload.get("barcode_type", "EAN-13") if payload else "EAN-13"
        return InventoryService.generate_barcode(db=db, item_id=item_id, barcode_type=barcode_type)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/schemes")
def get_free_schemes(db: Session = Depends(get_db)):
    """List all promotional free schemes."""
    return InventoryService.get_free_schemes(db=db)


@router.post("/schemes", status_code=status.HTTP_201_CREATED)
def create_free_scheme(
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Create a new promotional free scheme."""
    return InventoryService.create_free_scheme(db=db, data=payload)


@router.delete("/schemes/{scheme_id}")
def delete_free_scheme(
    scheme_id: str,
    db: Session = Depends(get_db)
):
    """Delete a promotional scheme."""
    try:
        return InventoryService.delete_free_scheme(db=db, scheme_id=scheme_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{item_id}")
def update_inventory_item(
    item_id: str,
    payload: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Update details of an existing inventory product."""
    try:
        return InventoryService.update_inventory_item(db=db, item_id=item_id, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/{item_id}")
def delete_inventory_item(
    item_id: str,
    db: Session = Depends(get_db)
):
    """Delete an item from gym inventory."""
    try:
        return InventoryService.delete_inventory_item(db=db, item_id=item_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
