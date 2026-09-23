export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/favicon.png"
        alt="LazyMonkey FIT CLUB AI"
        className="w-9 h-9 rounded-xl object-contain shrink-0 shadow-sm"
      />
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-extrabold text-navy-900 tracking-tight">FIT CLUB</span>
          <span className="text-[10px] font-bold text-brand-600 tracking-widest">LAZYMONKEY AI</span>
        </div>
      )}
    </div>
  );
}
