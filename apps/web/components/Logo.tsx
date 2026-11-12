import Image from "next/image";

/** The Toura "t" with its dotted trail to the destination dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="509 339 310 292" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="#F6F1E9" strokeWidth="42" strokeLinecap="round" strokeLinejoin="round">
        <path d="M595 362V540a68 68 0 0 0 68 68h2" />
        <path d="M532 444H665" />
      </g>
      <g fill="#F6F1E9">
        <circle cx="712.5" cy="599.5" r="11" />
        <circle cx="750.5" cy="577" r="11" />
        <circle cx="779" cy="545.5" r="10.5" />
      </g>
      <circle cx="791.5" cy="494.5" r="25" fill="#F28C38" />
    </svg>
  );
}

/** Mark + "toura" wordmark, as drawn in the brand logo. */
export default function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className="h-[30px] w-auto md:h-[34px]" />
      <Image
        src="/brand/toura-wordmark.png"
        alt="Toura"
        width={455}
        height={136}
        priority
        className="h-[19px] w-auto md:h-[22px]"
      />
    </span>
  );
}
