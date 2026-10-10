// Run: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { railPoint, rimFacing, rimPoint, type Point } from "./table-shape.ts";

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
