// Run: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEALER_SPOT, SEAT_SPOTS, SPOT_COUNT, joinSeat, railPoint, rimFacing, rimPoint, seatChair, seatSpot, spotAngle, type Point } from "./table-shape.ts";

const WIDE = 2; // the desktop table box, width / height
const TALL = 3 / 4; // the phone table box

const TOP = -Math.PI / 2;
const RIGHT = 0;
const BOTTOM = Math.PI / 2;
const LEFT = Math.PI;

function assertNear(actual: Point, expected: Point, message = "") {
  const close = Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.y - expected.y) < 1e-9;
  assert.ok(close, `${message} expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`);
}

/** True when a point (in % of the box) lies on the outline of the stadium that fills a box of this aspect. */
function isOnStadium(point: Point, aspect: number): boolean {
  // In box units: height 1, width `aspect`, center at 0. Tall boxes are wide boxes turned on their side.
  const x = ((point.x - 50) * aspect) / 100;
  const y = (point.y - 50) / 100;
  const tall = aspect < 1;
  const along = tall ? y : x;
  const across = tall ? x : y;
  const shortSide = tall ? aspect : 1;
  const longSide = tall ? 1 : aspect;
  const endRadius = shortSide / 2;
  const straightHalf = longSide / 2 - endRadius;

  const onStraightSide = Math.abs(Math.abs(across) - endRadius) < 1e-9 && Math.abs(along) <= straightHalf + 1e-9;
  const endCenter = Math.sign(along) * straightHalf;
  const onEnd = Math.abs(along) >= straightHalf && Math.abs(Math.hypot(along - endCenter, across) - endRadius) < 1e-9;
  return onStraightSide || onEnd;
}

describe("the table's stadium shape", () => {
  test("on a wide table, the rim touches the middle of each side of the box", () => {
    assertNear(rimPoint(TOP, 1, WIDE), { x: 50, y: 0 });
    assertNear(rimPoint(RIGHT, 1, WIDE), { x: 100, y: 50 });
    assertNear(rimPoint(BOTTOM, 1, WIDE), { x: 50, y: 100 });
    assertNear(rimPoint(LEFT, 1, WIDE), { x: 0, y: 50 });
  });

  test("a wide table has straight long sides and round ends", () => {
    const onTopSide = rimPoint(TOP + 0.2, 1, WIDE);
    assert.ok(Math.abs(onTopSide.y) < 1e-9, `y should be 0, got ${onTopSide.y}`);
    assert.ok(onTopSide.x > 25 && onTopSide.x < 75);
    const onRightEnd = rimPoint(-Math.PI / 4, 1, WIDE);
    assert.ok(onRightEnd.x > 75 && onRightEnd.y > 0, "a diagonal reaches the round end");
  });

  test("a tall table is the same shape turned on its side", () => {
    assertNear(rimPoint(TOP, 1, TALL), { x: 50, y: 0 });
    assertNear(rimPoint(RIGHT, 1, TALL), { x: 100, y: 50 });
    const onRightSide = rimPoint(RIGHT + 0.1, 1, TALL);
    assert.ok(Math.abs(onRightSide.x - 100) < 1e-9, `x should be 100, got ${onRightSide.x}`);
  });

  test("every point at radius 1 is on the outline, all the way round", () => {
    for (const aspect of [WIDE, TALL]) {
      for (let step = 0; step < 72; step++) {
        const angle = (step * 2 * Math.PI) / 72;
        const point = rimPoint(angle, 1, aspect);
        assert.ok(isOnStadium(point, aspect), `aspect ${aspect}, angle ${angle.toFixed(2)}: (${point.x}, ${point.y}) is off the outline`);
      }
    }
  });

  test("a smaller radius moves the point in toward the center", () => {
    const rim = rimPoint(0.7, 1, WIDE);
    assertNear(rimPoint(0.7, 0.5, WIDE), { x: 50 + (rim.x - 50) / 2, y: 50 + (rim.y - 50) / 2 });
  });
});

describe("points on the rail", () => {
  test("move in from the rim by the same width all the way round", () => {
    // A rail 5% of the box width thick: 10% of a wide box's height, 5% of its width.
    assertNear(railPoint(TOP, 0.05, WIDE), { x: 50, y: 10 }, "top");
    assertNear(railPoint(RIGHT, 0.05, WIDE), { x: 95, y: 50 }, "right end");
  });

  test("turn to face the rail: 0° at the top, 90° at the right, 180° at the bottom", () => {
    assert.ok(Math.abs(rimFacing(TOP, WIDE)) < 1e-9);
    assert.ok(Math.abs(rimFacing(TOP + 0.2, WIDE)) < 1e-9, "anywhere along a straight side");
    assert.ok(Math.abs(rimFacing(RIGHT, WIDE) - 90) < 1e-9);
    assert.ok(Math.abs(rimFacing(BOTTOM, WIDE) - 180) < 1e-9);
    assert.ok(Math.abs(rimFacing(LEFT, TALL) + 90) < 1e-9);
  });
});

describe("spots round the table", () => {
  const SEAT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9];
  /** The spots of seats 0 to count - 1, as `viewer` sees the table. */
  const spotsOf = (count: number, viewer = 0) => Array.from({ length: count }, (_, seat) => seatSpot(seat, viewer, count));
  /** Spots next to each other round the table (the dealer's spot counts, so the two beside it aren't neighbors). */
  const areNeighbors = (a: number, b: number) => Math.abs(a - b) === 1 || Math.abs(a - b) === SPOT_COUNT - 1;

  test("the dealer's spot is the top center", () => {
    assertNear(rimPoint(spotAngle(DEALER_SPOT), 1, WIDE), { x: 50, y: 0 });
    assertNear(rimPoint(spotAngle(DEALER_SPOT), 1, TALL), { x: 50, y: 0 });
  });

  test("spots go clockwise from the bottom center: the next one is down on the left", () => {
    assertNear(rimPoint(spotAngle(0), 1, WIDE), { x: 50, y: 100 });
    const next = rimPoint(spotAngle(1), 1, WIDE);
    assert.ok(next.x < 50 && next.y > 50, `(${next.x}, ${next.y}) should be bottom left`);
  });

  test("everyone sees themselves at the bottom center; a watcher sees seat 0 there", () => {
    for (const count of SEAT_COUNTS) {
      for (let viewer = 0; viewer < count; viewer++) {
        assert.equal(seatSpot(viewer, viewer, count), 0);
      }
      assert.equal(seatSpot(0, -1, count), 0);
    }
  });

  test("every seat has its own seat spot, never the dealer's, for every viewer", () => {
    for (let viewer = -1; viewer < SEAT_SPOTS.length; viewer++) {
      const spots = spotsOf(SEAT_SPOTS.length, viewer);
      assert.deepEqual([...spots].sort((a, b) => a - b), SEAT_SPOTS, `viewer ${viewer}: ${spots}`);
    }
  });

  test("play runs clockwise: the turn goes up the seat numbers, and each seat sits further round than the one before", () => {
    for (const count of SEAT_COUNTS) {
      for (let viewer = -1; viewer < count; viewer++) {
        const bottomSeat = Math.max(viewer, 0);
        const spots = spotsOf(count, viewer);
        // The order of play, starting with the seat at the bottom.
        const inTurnOrder = spots.map((_, turn) => spots[(bottomSeat + turn) % count]);
        const clockwise = inTurnOrder.every((spot, turn) => turn === 0 || spot > inTurnOrder[turn - 1]);
        assert.ok(clockwise, `${count} players, viewer ${viewer}: ${inTurnOrder.join(" -> ")}`);
      }
    }
  });

  test("the table stays spread out as it fills: 5 players sit evenly, 7 symmetrically", () => {
    assert.deepEqual([...spotsOf(5)].sort((a, b) => a - b), [0, 2, 4, 6, 8]);
    const seven = spotsOf(7);
    assert.ok(seven.every((spot) => seven.includes((SPOT_COUNT - spot) % SPOT_COUNT)), `mirror image: ${seven}`);
    for (const count of [2, 3, 4, 5]) {
      const spots = spotsOf(count);
      const crowded = spots.some((a) => spots.some((b) => areNeighbors(a, b)));
      assert.ok(!crowded, `${count} players should not sit side by side: ${spots}`);
    }
  });

  test("nobody moves when someone joins: the newcomer gets a seat number, the others keep their spots and colors", () => {
    for (let count = 1; count < SEAT_SPOTS.length; count++) {
      const newSeat = joinSeat(count);
      assert.ok(newSeat >= 1 && newSeat <= count, `the host keeps seat 0: ${newSeat}`);
      const seatAfterJoin = (seat: number) => (seat >= newSeat ? seat + 1 : seat);

      for (let viewer = 0; viewer < count; viewer++) {
        const before = spotsOf(count, viewer);
        const after = spotsOf(count + 1, seatAfterJoin(viewer));
        const newcomerSpot = after[newSeat];
        assert.deepEqual(after.toSpliced(newSeat, 1), before, `${count} players, viewer ${viewer}`);
        assert.ok(!before.includes(newcomerSpot), "the newcomer takes an open spot");
      }
      for (let seat = 0; seat < count; seat++) {
        assert.equal(seatChair(seatAfterJoin(seat), count + 1), seatChair(seat, count));
      }
    }
  });
});
