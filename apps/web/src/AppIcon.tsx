export function AppIcon({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <img
      src="/bullion-ledger-icon.svg"
      width="512"
      height="512"
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`shrink-0 rounded-[22%] ${className}`}
    />
  );
}
