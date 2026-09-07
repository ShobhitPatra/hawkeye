import { MARK_EYE, MARK_PATHS } from "@/mark-paths";

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
      {MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
      <circle cx={MARK_EYE.cx} cy={MARK_EYE.cy} r={MARK_EYE.r} fill="currentColor" stroke="none" />
    </svg>
  );
}
