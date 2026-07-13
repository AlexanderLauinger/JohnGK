// The "GK" mark — navy rounded square, gold double border, serif italic GK.
export default function Logo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="John G.K.">
      <defs>
        <linearGradient id="gk-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e2f8f" />
          <stop offset="1" stopColor="#141f66" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="61" height="61" rx="13" fill="url(#gk-bg)" stroke="#e3b23c" strokeWidth="2" />
      <rect x="6.5" y="6.5" width="51" height="51" rx="9" fill="none" stroke="#e3b23c" strokeWidth="1.2" opacity="0.85" />
      <text x="32" y="43" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic" fontWeight="bold"
        fontSize="27" fill="#e3b23c" textAnchor="middle">GK</text>
    </svg>
  );
}
