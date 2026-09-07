export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 17c2-6 5-9 9-10l6-1.5" />
      <path d="M15 7c-1 4-3.5 6-7 7" />
      <path d="M7 15l-2 4 4-2" />
      <circle cx="16.5" cy="6.6" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}
