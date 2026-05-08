// Inline SVG flow diagram used by /docs/jobbmarked, /docs/media, /docs/oppstart.
// Six horizontal boxes (Kilde → 4 prosess-stadier → Dashboard), arrows
// between, cadence label below each transition. Uses CSS-variable colors so
// the diagram adapts to light + dark mode without extra logic.

type PipelineFlowProps = {
  ariaTitle: string;
  // Six box labels: source, four pipeline stages, dashboard target.
  steps: [string, string, string, string, string, string];
  // Five cadence labels, one per arrow (rendered under boxes 2..6).
  cadences: [string, string, string, string, string];
  // Unique id prefix so multiple diagrams on one page do not clash on
  // marker / title id refs.
  idPrefix: string;
};

const BOX_X = [0, 124, 248, 372, 496, 620] as const;
const BOX_W = 100;
const BOX_Y = 40;
const BOX_H = 40;

export function PipelineFlow({
  ariaTitle,
  steps,
  cadences,
  idPrefix,
}: PipelineFlowProps) {
  const titleId = `${idPrefix}-title`;
  const arrowId = `${idPrefix}-arr`;

  return (
    <svg
      viewBox="0 0 720 110"
      xmlns="http://www.w3.org/2000/svg"
      className="my-6 w-full max-w-3xl"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>{ariaTitle}</title>
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-muted-foreground"
      >
        {BOX_X.map((x) => (
          <rect key={x} x={x} y={BOX_Y} width={BOX_W} height={BOX_H} rx="4" />
        ))}
        {BOX_X.slice(0, 5).map((x, i) => {
          const x1 = x + BOX_W;
          const x2 = BOX_X[i + 1];
          return (
            <path
              key={`a-${i}`}
              d={`M${x1} ${BOX_Y + BOX_H / 2} L${x2} ${BOX_Y + BOX_H / 2}`}
              markerEnd={`url(#${arrowId})`}
            />
          );
        })}
      </g>
      <g
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="11"
        textAnchor="middle"
        className="text-foreground"
      >
        {steps.map((label, i) => (
          <text key={i} x={BOX_X[i] + BOX_W / 2} y={BOX_Y + BOX_H / 2 + 4}>
            {label}
          </text>
        ))}
      </g>
      <g
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="9"
        textAnchor="middle"
        className="text-muted-foreground"
      >
        {cadences.map((cad, i) => (
          <text key={i} x={BOX_X[i + 1] + BOX_W / 2} y={BOX_Y + BOX_H + 18}>
            {cad}
          </text>
        ))}
      </g>
    </svg>
  );
}
