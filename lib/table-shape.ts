// The poker table's shape: a stadium, like a real table - two straight long sides joined by half circles.
// Points are in % of the table box, so they depend on the box's aspect ratio (width / height): a wide box gets
// a table lying sideways, a tall box (phones) the same table standing up.

/** A spot on the table, in % of the table box. */
export type Point = { x: number; y: number };

/** Where a ray from the center meets the rim, in box units (height 1, center 0), with the outward normal there. */
type RimHit = { x: number; y: number; normalX: number; normalY: number };

/**
 * Where the rim is in the direction of `angle`. The angle is measured as if the table were a circle drawn in %
 * of the box, which is how seats are spread out, so they keep their spacing on any box.
 */
function rimHit(angle: number, aspect: number): RimHit {
  const directionX = (Math.cos(angle) * aspect) / 2;
  const directionY = Math.sin(angle) / 2;

  // Work on a wide stadium: "along" its long axis and "across" it. A tall box is a wide one turned on its side.
  const tall = aspect < 1;
  const rawAlong = tall ? directionY : directionX;
  const rawAcross = tall ? directionX : directionY;
  const length = Math.hypot(rawAlong, rawAcross);
  const along = rawAlong / length;
  const across = rawAcross / length;
  const longSide = tall ? 1 : aspect;
  const shortSide = tall ? aspect : 1;
  const endRadius = shortSide / 2;
  const straightHalf = longSide / 2 - endRadius; // half the length of each straight side

  let distance: number;
  let normalAlong: number;
  let normalAcross: number;
  const toStraightSide = across === 0 ? Infinity : endRadius / Math.abs(across);
  const hitsStraightSide = Math.abs(toStraightSide * along) <= straightHalf;
  if (hitsStraightSide) {
    distance = toStraightSide;
    normalAlong = 0;
    normalAcross = Math.sign(across);
  } else {
    // The round end: the ray's far crossing of the circle around that end's center.
    const endCenter = Math.sign(along) * straightHalf;
    const projection = along * endCenter;
    distance = projection + Math.sqrt(projection * projection - endCenter * endCenter + endRadius * endRadius);
    normalAlong = (distance * along - endCenter) / endRadius;
    normalAcross = (distance * across) / endRadius;
  }

  const hitAlong = distance * along;
  const hitAcross = distance * across;
  if (tall) {
    return { x: hitAcross, y: hitAlong, normalX: normalAcross, normalY: normalAlong };
  }
  return { x: hitAlong, y: hitAcross, normalX: normalAlong, normalY: normalAcross };
}

const toPercent = (x: number, y: number, aspect: number): Point => ({ x: 50 + (100 * x) / aspect, y: 50 + 100 * y });

/** The point at `angle`, `radius` of the way from the center out to the rim (1 = the table's outer edge). */
export function rimPoint(angle: number, radius: number, aspect: number): Point {
  const hit = rimHit(angle, aspect);
  return toPercent(hit.x * radius, hit.y * radius, aspect);
}

/**
 * The point at `angle`, `inset` in from the outer edge, straight in from the rim. `inset` is a fraction of the box
 * width, like the rail's thickness (CSS padding in % is a share of the width on every side).
 */
export function railPoint(angle: number, inset: number, aspect: number): Point {
  const hit = rimHit(angle, aspect);
  const insetInBoxUnits = inset * aspect;
  return toPercent(hit.x - hit.normalX * insetInBoxUnits, hit.y - hit.normalY * insetInBoxUnits, aspect);
}

/** How far to rotate something (degrees) so its top faces the rail at `angle`: 0 at the top, 90 at the right. */
export function rimFacing(angle: number, aspect: number): number {
  const hit = rimHit(angle, aspect);
  return (Math.atan2(hit.normalX, -hit.normalY) * 180) / Math.PI;
}

// ---- spots round the table ----

/** The table has 10 fixed spots, evenly spaced: the dealer's at the top center and 9 seats. */
export const SPOT_COUNT = 10;
export const DEALER_SPOT = 5;
/** The 9 seat spots, clockwise from the bottom center, which is always yours. */
export const SEAT_SPOTS = [0, 1, 2, 3, 4, 6, 7, 8, 9];

/** The angle of a spot, for `rimPoint` and friends: 0 at the bottom center, then clockwise. Fractions fall between spots. */
export const spotAngle = (spot: number) => Math.PI / 2 + (spot * 2 * Math.PI) / SPOT_COUNT;

/**
 * The order the 9 seat spots fill as players sit down, as indexes into SEAT_SPOTS. Each seat keeps its spot for
 * good, so nobody moves when someone joins a running table, and every early arrival lands well apart from the
 * others: 5 players sit evenly, 7 in a mirror image.
 */
const FILL_ORDER = [0, 5, 2, 7, 4, 3, 6, 1, 8];

/**
 * The spot where `seat` sits as `viewer` sees the table: the table is turned so the viewer's own seat is at the
 * bottom center, keeping the dealer at the top. A viewer of -1 is only watching and sees seat 0 at the bottom.
 */
export function seatSpot(seat: number, viewer: number): number {
  const bottomSeat = viewer >= 0 ? viewer : 0;
  const turned = FILL_ORDER[seat] - FILL_ORDER[bottomSeat] + SEAT_SPOTS.length;
  return SEAT_SPOTS[turned % SEAT_SPOTS.length];
}
