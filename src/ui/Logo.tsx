export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
      <defs>
        <linearGradient id="ml-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#20264a" />
          <stop offset="1" stop-color="#2c1d4d" />
        </linearGradient>
        <linearGradient id="ml-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4f8cff" />
          <stop offset="0.35" stop-color="#8b5cff" />
          <stop offset="0.65" stop-color="#ff5f9e" />
          <stop offset="1" stop-color="#ffab4f" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill="url(#ml-bg)" />
      <circle cx="56" cy="56" r="29" fill="none" stroke="url(#ml-ring)" stroke-width="10" />
      <path d="M78 78l22 22" stroke="url(#ml-ring)" stroke-width="12" stroke-linecap="round" />
      <path d="M43 50h26M43 62h17" stroke="#fff" stroke-width="7" stroke-linecap="round" />
    </svg>
  );
}
