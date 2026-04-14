import "./thanos-snap.css";

/** Total duration of the `.thanos-snap` animation in milliseconds.
 *  Parents should keep the element mounted for at least this long after
 *  toggling the class, then unmount. */
export const THANOS_SNAP_DURATION_MS = 1400;

/** CSS class consumers add to the element they want to disintegrate. */
export const THANOS_SNAP_CLASS = "thanos-snap";

/**
 * One-time SVG filter mount. Drop a single `<ThanosSnapFilter />` somewhere
 * near the app root so the filter id is available document-wide.
 *
 * The animated `feTurbulence` baseFrequency drives chaotic noise growth, and
 * the `feDisplacementMap` scale ramps from 0 to a large value, scattering the
 * source pixels along the noise field — a passable Decimation-snap.
 */
export function ThanosSnapFilter() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <filter id="thanos-snap-filter" x="-50%" y="-50%" width="200%" height="200%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="noise">
            <animate
              attributeName="baseFrequency"
              from="0.012"
              to="0.55"
              dur="1400ms"
              fill="freeze"
            />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G">
            <animate attributeName="scale" from="0" to="90" dur="1400ms" fill="freeze" />
          </feDisplacementMap>
        </filter>
      </defs>
    </svg>
  );
}
