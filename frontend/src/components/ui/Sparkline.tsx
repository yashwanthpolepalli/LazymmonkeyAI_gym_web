import { cn } from '@/utils/cn';

interface SparklineProps {
  data: number[];
  color?: string;
  className?: string;
  height?: number;
}

export function Sparkline({ data, color = '#2563eb', className, height = 32 }: SparklineProps) {
  if (!data || !data.length) return null;
  const validData = data.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...validData);
  const min = Math.min(...validData);
  const range = max - min || 1;
  const w = 100;
  const h = height;

  const points = validData.length === 1
    ? [`0,${h / 2}`, `${w},${h / 2}`]
    : validData.map((v, i) => {
        const x = (i / (validData.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 4) - 2;
        return `${x},${y}`;
      });

  const pathD = `M ${points.join(' L ')}`;
  const areaD = `${pathD} L ${w},${h} L 0,${h} Z`;
  const gid = `spark-${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('w-full', className)} style={{ height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gid})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
