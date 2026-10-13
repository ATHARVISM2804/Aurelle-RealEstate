/* ==========================================================
   Floor plate + unit data for the residence explorer.
   Unit polygons are traced on assets/img/plate-*.webp in a 1000 × 558
   space (the plate renders are 2752 × 1536).
   entry: red entrance marker position on the 2D plan, in % of the image.
   ========================================================== */
window.UNIT_PLANS = {
  oneBhkStudy: { d2: 'plan-1bhk-study', d3: 'iso-1bhk-study', entry: [47.6, 3.5] },
  oneBhk: { d2: 'plan-1bhk', d3: 'iso-1bhk', entry: [59, 3.5] },
  twoBhk: { d2: 'plan-2bhk-maid', d3: 'iso-2bhk-maid', entry: [49, 3] },
  fourBhk: { d2: 'plan-4bhk-ph', d3: 'iso-4bhk-ph', entry: [53, 24] },
  threeBhk: { d2: 'plan-3bhk-ph', d3: 'iso-3bhk-ph', entry: [55, 9] },
};

/* Rooms you can step into from a unit plan.
   d2 / d3: the room's box on the 2D and 3D render, [x0, y0, x1, y1] in % of the image.
   type: picks the interior render and copy from ROOM_TYPES. */
window.ROOM_TYPES = {
  living: { name: 'Living room', img: 'room-living', line: 'Floor-to-ceiling glass and a room that gathers everyone.' },
  dining: { name: 'Dining', img: 'home-1', line: 'A table by the window, made for long evenings.' },
  kitchen: { name: 'Kitchen', img: 'room-kitchen', line: 'Italian cabinetry, stone island, a view while you cook.' },
  master: { name: 'Master suite', img: 'room-bedroom', line: 'Wake up to the skyline. Close the curtains on the city.' },
  bedroom: { name: 'Bedroom', img: 'home-2', line: 'Quiet, warm and generously proportioned.' },
  bath: { name: 'Bathroom', img: 'room-bathroom', line: 'Stone, oak and a freestanding tub.' },
  powder: { name: 'Powder room', img: 'room-bathroom', line: 'A guest washroom finished like the rest of the home.' },
  balcony: { name: 'Balcony', img: 'home-4', line: 'An outdoor room above the community.' },
  terrace: { name: 'Private terrace', img: 'terrace-social', line: 'Lounge, dine and watch the sun go down.' },
  jacuzzi: { name: 'Jacuzzi deck', img: 'jacuzzi', line: 'Warm water, open sky, your own.' },
  study: { name: 'Study', img: 'room-study', line: 'A quiet room to work, read or think.' },
  maid: { name: "Maid's room", img: 'room-maid', line: 'A separate room with its own bathroom.' },
};
window.UNIT_ROOMS = {
  twoBhk: [
    { type: 'living', d2: [36, 40, 52, 75], d3: [40, 44, 55, 73] },
    { type: 'dining', d2: [53, 40, 67, 75], d3: [56, 44, 68, 73] },
    { type: 'kitchen', d2: [37, 8, 60, 38], d3: [40, 10, 62, 40] },
    { type: 'master', d2: [17, 36, 35, 75], d3: [16, 40, 35, 72] },
    { type: 'bath', d2: [17, 18, 33, 34], d3: [17, 19, 34, 37] },
    { type: 'bedroom', d2: [68, 40, 84, 76], d3: [69, 40, 85, 73] },
    { type: 'bath', d2: [71, 24, 84, 39], d3: [71, 24, 84, 38], name: 'Second bathroom' },
    { type: 'maid', d2: [62, 8, 70, 40], d3: [63, 11, 71, 42] },
    { type: 'balcony', d2: [17, 77, 67, 92], d3: [14, 75, 69, 93] },
  ],
  oneBhkStudy: [
    { type: 'living', d2: [42, 44, 79, 75], d3: [43, 46, 82, 72] },
    { type: 'dining', d2: [53, 26, 66, 42], d3: [55, 28, 67, 45] },
    { type: 'kitchen', d2: [66, 9, 79, 38], d3: [65, 11, 80, 40] },
    { type: 'master', d2: [20, 55, 41, 93], d3: [17, 56, 40, 88], name: 'Bedroom' },
    { type: 'bath', d2: [20, 36, 35, 54], d3: [20, 32, 35, 47] },
    { type: 'study', d2: [20, 9, 41, 34], d3: [21, 10, 43, 30] },
    { type: 'powder', d2: [53, 9, 62, 25], d3: [54, 11, 63, 24] },
    { type: 'balcony', d2: [42, 76, 80, 94], d3: [41, 75, 85, 95] },
  ],
  oneBhk: [
    { type: 'living', d2: [30, 47, 52, 77], d3: [29, 42, 52, 72] },
    { type: 'dining', d2: [52, 55, 59, 73], d3: [52, 55, 60, 70] },
    { type: 'kitchen', d2: [59, 47, 74, 79], d3: [60, 42, 76, 72] },
    { type: 'master', d2: [30, 11, 55, 45], d3: [30, 12, 55, 38], name: 'Bedroom' },
    { type: 'bath', d2: [55, 10, 74, 34], d3: [55, 12, 74, 38] },
    { type: 'balcony', d2: [30, 79, 60, 93], d3: [28, 78, 61, 94] },
  ],
  fourBhk: [
    { type: 'living', d2: [51, 30, 68, 60], d3: [52, 30, 68, 60] },
    { type: 'dining', d2: [70, 30, 84, 57], d3: [70, 30, 82, 57] },
    { type: 'kitchen', d2: [57, 62, 88, 92], d3: [57, 62, 88, 90] },
    { type: 'master', d2: [6, 29, 23, 55], d3: [8, 30, 23, 55] },
    { type: 'bath', d2: [23, 29, 31, 48], d3: [23, 30, 31, 50], name: 'Master bathroom' },
    { type: 'bedroom', d2: [31, 29, 43, 60], d3: [31, 30, 44, 60], name: 'Bedroom 2' },
    { type: 'bedroom', d2: [9, 71, 25, 92], d3: [9, 70, 24, 90], name: 'Bedroom 3' },
    { type: 'bath', d2: [25, 70, 37, 91], d3: [24, 70, 36, 88], name: 'Family bathroom' },
    { type: 'powder', d2: [44, 70, 51, 85], d3: [44, 70, 51, 84] },
    { type: 'jacuzzi', d2: [5, 6, 19, 27], d3: [9, 10, 20, 28] },
    { type: 'terrace', d2: [20, 5, 92, 28], d3: [20, 10, 92, 28] },
  ],
  threeBhk: [
    { type: 'living', d2: [31, 29, 48, 62], d3: [52, 26, 66, 46] },
    { type: 'dining', d2: [48, 29, 57, 50], d3: [64, 22, 75, 34] },
    { type: 'kitchen', d2: [33, 63, 51, 84], d3: [70, 36, 84, 46] },
    { type: 'master', d2: [75, 20, 90, 48], d3: [14, 46, 30, 62] },
    { type: 'bedroom', d2: [57, 20, 70, 50], d3: [34, 36, 48, 52], name: 'Bedroom 2' },
    { type: 'bedroom', d2: [16, 58, 27, 83], d3: [28, 62, 42, 82], name: 'Bedroom 3' },
    { type: 'bath', d2: [70, 58, 76, 83], d3: [42, 56, 54, 70] },
    { type: 'jacuzzi', d2: [11, 10, 20, 25], d3: [9, 33, 21, 45] },
    { type: 'terrace', d2: [20, 10, 90, 22], d3: [30, 8, 88, 30] },
  ],
};

window.FLOOR_PLATES = {
  typical: {
    img: 'plate-typical',
    caption: 'Typical floor plan of levels 02, 04, 08 and 10',
    units: [
      { id: 'A', name: '2 BHK + Maid Room', type: 'Type A', pos: 'Corner north-west', color: 'blue', plan: 'twoBhk',
        pts: '152,75 420,75 420,235 390,235 390,270 152,270', areas: ['1,084.40', '96.20', '1,180.60'] },
      { id: 'E', name: '2 BHK + Maid Room', type: 'Type A', pos: 'Corner north-east', color: 'blue', plan: 'twoBhk',
        pts: '625,75 850,75 850,270 625,270', areas: ['1,084.40', '96.20', '1,180.60'] },
      { id: 'B', name: '1 BHK + Study', type: 'Type B', pos: 'Centre left', color: 'green', plan: 'oneBhkStudy',
        pts: '152,270 415,270 415,490 152,490', areas: ['679.10', '141.22', '820.32'] },
      { id: 'C', name: '1 BHK', type: 'Type C', pos: 'Centre', color: 'lilac', plan: 'oneBhk',
        pts: '415,270 600,270 600,490 415,490', areas: ['588.60', '84.10', '672.70'] },
      { id: 'D', name: '1 BHK + Study', type: 'Type B', pos: 'Centre right', color: 'green', plan: 'oneBhkStudy',
        pts: '600,270 850,270 850,490 600,490', areas: ['679.10', '141.22', '820.32'] },
    ],
  },
  penthouse: {
    img: 'plate-penthouse',
    caption: 'Typical floor plan of level 15 — penthouse',
    units: [
      { id: 'P1', name: '4 BHK Penthouse with Jacuzzi', type: 'Type A', pos: 'Left wing', color: 'olive', plan: 'fourBhk',
        pts: '60,45 362,45 362,125 412,125 412,465 60,465', areas: ['2,946.10', '410.30', '3,356.40'] },
      { id: 'P2', name: '2 BHK + Maid Room', type: 'Type C', pos: 'Centre', color: 'navy', plan: 'twoBhk',
        pts: '405,285 600,285 600,525 405,525', areas: ['1,102.80', '88.40', '1,191.20'] },
      { id: 'P3', name: '3 BHK Penthouse with Jacuzzi', type: 'Type B', pos: 'Right wing', color: 'orange', plan: 'threeBhk',
        pts: '600,95 940,95 940,465 600,465', areas: ['2,410.50', '362.00', '2,772.50'] },
    ],
  },
};
