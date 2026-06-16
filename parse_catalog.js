const fs = require('fs');

// Read from stdin or file
const input = fs.readFileSync(process.argv[2] || 0, 'utf8');

const lines = input.split(/\r?\n/);

// Category detection rules - order matters, first match wins
const CATEGORY_RULES = [
  { re: /BATTER|DUCELL|EXIDE|RAYLITE|SOLAR.*BATT/i, cat: 'Batteries' },
  { re: /BEARING|UCP|UCF|UCFL|P\/BLOCK|PLUMMER|ADAPTER SLEEVE|TAPPER ROLLER|BALL RACER/i, cat: 'Bearings & Bushes' },
  { re: /BOLT|NUT\b|WASHER|STUDDING|NYLOC|EXPANSION/i, cat: 'Bolts, Nuts & Washers' },
  { re: /\bENGINE\b|PISTON|SLEEVE|CONROD|CRANK.*SHAFT|GASKET|VALVE\b|INJECTOR|CARBURETOR|RING.*PISTON|CYLINDER.*HEAD|OIL.*PUMP|WATER.*PUMP.*ENG|AIR.*FILTER|FUEL.*FILTER|DIESEL/i, cat: 'Engine & Spares' },
  { re: /GENERATOR|ALTERNATOR|AVR|EXCITOR|DIOTS|CARBON.*BRUSH/i, cat: 'Generators & Alternators' },
  { re: /WELDING|ELECTRODE|WELDING.*ROD|BRAZING|EARTH CLAMP|CUTTING.*TORCH|REGULATOR|GAS.*CUT|WELDING.*CABLE|WELDING.*MACHINE/i, cat: 'Welding & Cutting' },
  { re: /GRINDER\b|DRILL\b|GRINDING|CUTTING.*WHEEL|FLAP DISC|SAW\b|CIRCULAR|IMPACT|CHAIN.*SAW|BRUSH.*CUTTER|PLANER|HAMMER.*DRILL|ANGLE.*GRINDER/i, cat: 'Power Tools' },
  { re: /SEWAGE.*PUMP|WATER.*PUMP|BOOSTER.*PUMP|SUBMERSIBLE|PUMP.*SIDE|MOTOR.*SIDE|SUBPUMP|CONTROL.*BOX.*KW|IMPELLER|MECHANICAL.*SEAL|FLOAT.*SWITCH|STATOR.*COIL/i, cat: 'Pumps & Spares' },
  { re: /CABLE|WIRE\b|INSULATION.*TAPE|ARMOURED|BARED EARTH|FLEX\b|SINGLE.*CORE|AIRDAC/i, cat: 'Cables & Wiring' },
  { re: /MCB\b|BREAKER|CONTACTOR|RELAY\b|STARTER|TIMER|PUSH BUTTON|INDICATION|LAMP|SWITCH\b|SOCKET|PLUG|DISTRIBUTION.*BOX|TERMINAL|CABLE.*TIE|CABLE.*GLAND|DIN RAIL|COPPER.*LUG|AUTO.*TRANSFER|METER\b|RECTIFIER|TEMPERATURE.*CONTROLLER/i, cat: 'Electrical & Switchgear' },
  { re: /\bBOOT\b|GUMBOOT|SAFETY.*BOOT|SHOE\b|CHELSEA|BOVA|WAYNE/i, cat: 'Safety Footwear' },
  { re: /HELMET|GOGGLE|SPECT|DUST.*MASK|CHEMICAL.*MASK|WELDING.*HELMET|EAR.*PLUG|EAR.*CUP|SAFETY.*GLASS|WORKSUIT|OVERALL|DUST.*COAT|GLOVE|PVC.*GLOVE|LEATHER.*GLOVE|SAFETY.*BELT|SAFETY.*HARNESS|REFLECTOR/i, cat: 'PPE & Workwear' },
  { re: /PVC\b|HDPE|POLY.*PIPE|COUPLING|ELBOW|TEE\b|END.*PLUG|BALL.*VALVE|CHECK.*VALVE|FOOT.*VALVE|REDUCING|UNION\b|FLANGE|CLAMP.*SADDLE|SOLVENT|GATE.*VALVE|BRASS|GALV.*SOCKET|GALV.*ELBOW|GALV.*TEE|NIPPLE|HOSE.*CLAMP|JOHNSON|NON.*RETURN|STRAINER|CAMLO/i, cat: 'Plumbing & Fittings' },
  { re: /GREASE|OIL\b|DEGREASE|LUBRICANT|BRAKE.*FLUID|TWO.*STROKE|SAE|GEAR.*OIL|HYDRAULIC.*OIL|COMPRESSOR.*OIL/i, cat: 'Lubricants & Oils' },
  { re: /CHAIN.*BLOCK|PALLET.*TRUCK|PALLET.*STACK|WINCH|HOIST|LIFTING|WIRE.*ROPE|JACK\b|FLOOR.*JACK|BOTTLE.*JACK|JACK.*STAND|CHAIN.*PIPE.*WRENCH|CRANE\b|HEAD.*WHEEL|BRAKE\b.*T|SHIEVE.*WHEEL/i, cat: 'Lifting & Handling' },
  { re: /COMPRESSOR|AIRLEG|JACKHAMMER|DRILL.*STEEL|PUM.*PUM|CHUCK|MINE.*BLOWER|MUFFLER|RIFFLE|THROTTLE|DEMOLITION/i, cat: 'Mining & Compressor' },
  { re: /JAW.*CRUSHER|ROUND.*MILL|BALL.*MILL|HAMMER.*MILL|ROLLER.*MILL|STAMPMILL|SCREEN|CONVEYOR|SEPARATOR|BEATER|LINER\b|TOGGLE|SWING.*JAW|AMALGUM|ORE.*BIN|VIBRAT/i, cat: 'Mining Equipment' },
  { re: /SPANNER|SOCKET|PLIER|SCREWDRIVER|HAMMER|CHISEL|WRENCH|HACKSAW|MEASUR|TAPE|SPIRIT.*LEVEL|VERNIER|SHOVEL|PICK\b|AXE|CRAW.*BAR|BOLT.*CUTTER|G.*CLAMP|SPADE|RAKE|HOE|FILE|CUTTER.*KNIFE|TOOL.*SET|RATCHET|IMPACT.*SOCKET|HAND.*TAP|GREASE.*GUN|CAULKING|PISTON.*RING.*COMPRESS|PIPE.*WRENCH|LOCKING.*PLIER/i, cat: 'Hand Tools' },
  { re: /BEARING|SEAL|OIL.*SEAL|V.*BELT|PULLEY|TAPPER.*LOCK|BUSH\b|KEY\b|GEAR\b|COUPLING|CHAIN\b|SPROCKET|UNIVERSAL.*JOINT/i, cat: 'Power Transmission' },
  { re: /FENCE|BARBED.*WIRE|RAZOR.*WIRE|TYING.*WIRE|FIELD.*FENCE|GATE|POST\b|PANEL/i, cat: 'Fencing & Wire' },
  { re: /SHADE.*CLOTH|BLACK.*SHEET|GREEN.*MAT|RED.*MAT|POLYS.*ROPE|MUTTON.*CLOTH/i, cat: 'Sheeting & Textiles' },
  { re: /AMMONIUM|CYANIDE|NITRIC|HYDROCHLORIC|SULPHURIC|BORAX|LIME|CAUSTIC|LEAD.*NITRATE|SILVER.*NITRATE|ZINC.*DUST|AQUARAGIA|PHENOL|ACID|CHEMICAL|ACTIVATED.*CARBON|TIN.*GRANULE|POTASSIUM|ANTIDOTE|BEAKER|TEST.*TUBE|SYRINGE|PH.*PAPER/i, cat: 'Chemicals & Lab' },
  { re: /CONVEYOR|BELT\b.*MTR|ROLLER\b|FASTENER/i, cat: 'Conveyor Systems' },
  { re: /TRACTOR|DISC.*PLOUGH|FORKLIFT|WALKING.*TRACT|TRAILER|WHEELBARROW|MOULD.*BOARD|PLOUGH/i, cat: 'Agricultural & Vehicles' },
  { re: /AIR.*COMP|PRESSURE.*WASHER|SPRAYER|AIR.*HOSE|KNAPSACK/i, cat: 'Air & Pressure Equipment' },
  { re: /V.*BELT|BELT\b.*PK/i, cat: 'Power Transmission' },
];

function detectCategory(sku, name) {
  const combined = sku + ' ' + name;
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(combined)) return rule.cat;
  }
  return 'General Hardware';
}

// Parse catalog lines
const products = [];
let buffer = ''; // for multi-line product names
let idx = 0;

for (let i = 1; i < lines.length; i++) {
  let line = lines[i].replace(/\f/g, ''); // remove form feeds
  
  if (!line.trim()) continue;
  if (/^\s*$/.test(line)) continue;
  if (/^Page\s/i.test(line)) continue;
  
  // Skip lines that look like page breaks or headers
  if (/^Item\s+No/i.test(line)) continue;
  if (/^[-─]{3,}/.test(line)) continue;
  
  // Check if line has pricing at the end (product line)
  const priceMatch = line.match(/(\d+\.?\d*)\s+(\d+\.?\d*)\s*$/);
  if (!priceMatch) {
    // Might be continuation of previous name
    buffer += ' ' + line.trim();
    continue;
  }
  
  const exclPrice = parseFloat(priceMatch[1]);
  const inclPrice = parseFloat(priceMatch[2]);
  
  if (isNaN(inclPrice) || inclPrice <= 0) continue;
  
  let content;
  if (buffer) {
    content = buffer.trim();
    buffer = '';
  } else {
    content = line.substring(0, line.lastIndexOf(priceMatch[0])).trim();
  }
  
  // Extract SKU (first word before spaces)
  const skuMatch = content.match(/^(\S+)\s+(.*)$/);
  if (!skuMatch) continue;
  
  const sku = skuMatch[1].trim();
  let name = skuMatch[2].trim();
  
  // Remove "IT" if it appears as a unit indicator
  name = name.replace(/^IT\s+/, '').replace(/\s+IT\s*$/, '');
  
  // Skip if no valid name
  if (!name || name.length < 2) continue;
  
  // Clean up name
  name = name.replace(/\s+/g, ' ').trim();
  
  const category = detectCategory(sku, name);
  
  products.push({
    id: 'cp' + idx,
    sku: sku,
    name: name,
    price: inclPrice,
    priceExcl: exclPrice,
    stockQuantity: Math.floor(Math.random() * 200) + 3,
    unitOfMeasure: 'EA',
    barcode: 'C' + sku.padEnd(12, '0').substring(0, 12),
    partNumber: sku,
    category: category,
  });
  idx++;
}

// Write JSON
fs.writeFileSync('products.json', JSON.stringify(products, null, 2));
console.log(`Parsed ${products.length} products`);

// Show categories
const cats = {};
products.forEach(p => {
  cats[p.category] = (cats[p.category] || 0) + 1;
});
Object.entries(cats).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}`);
});
