export function HorizonMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <circle cx="11" cy="11" r="10" stroke="#5B8DEF" strokeWidth="1.25" />
        <path
          d="M2 12.5 C 6 10, 10 10, 14 12 S 20 14, 20 14"
          stroke="#5B8DEF"
          strokeWidth="1.25"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="font-display text-[15px] tracking-tight text-text">
        Horizon
      </span>
    </div>
  );
}
