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
 * The chair each arrival takes, as indexes into SEAT_SPOTS: the first player gets chair 0, the second chair 5...
 * A chair is for good, so nobody moves when someone joins a running table, and every early arrival lands well
 * apart from the others: 5 players sit evenly, 7 in a mirror image.
 */
const FILL_ORDER = [0, 5, 2, 7, 4, 3, 6, 1, 8];

/**
 * The chairs taken at a table of `playerCount`, clockwise. Seats are numbered the same way, so seat 1 sits on
 * seat 0's left and play, which goes up the seat numbers, runs clockwise as in real poker.
 */
const takenChairs = (playerCount: number) => FILL_ORDER.slice(0, playerCount).sort((a, b) => a - b);

/** The chair of `seat` at a table of `playerCount`. A player keeps it while their seat number changes (see joinSeat). */
export const seatChair = (seat: number, playerCount: number) => takenChairs(playerCount)[seat];

/**
 * The seat number a new player gets at a table of `playerCount`: their chair's place in the clockwise order.
 * Players from that seat on go up one seat number; everybody stays in their chair.
 */
export const joinSeat = (playerCount: number) => takenChairs(playerCount + 1).indexOf(FILL_ORDER[playerCount]);

/**
 * The spot where `seat` sits at a table of `playerCount`, as `viewer` sees it: the table is turned so the viewer's
 * own seat is at the bottom center, keeping the dealer at the top. A viewer of -1 is only watching and sees seat 0
 * at the bottom.
 */
export function seatSpot(seat: number, viewer: number, playerCount: number): number {
  const chairs = takenChairs(playerCount);
  const bottomSeat = viewer >= 0 ? viewer : 0;
  const turned = chairs[seat] - chairs[bottomSeat] + SEAT_SPOTS.length;
  return SEAT_SPOTS[turned % SEAT_SPOTS.length];
}
