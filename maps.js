// maps.js — FragValue CS2 Map Renderer
// Dessine les maps CS2 en Canvas avec polygones précis style CS Demo Manager

const CS2_MAPS = {

  de_dust2: {
    bounds: { minX: -2476, maxX: 1444, minY: -1228, maxY: 3346 },
    // Zones jouables (polygones)
    floors: [
      // Long A
      [[-2476,3346],[-1900,3346],[-1900,2800],[-2476,2800]],
      // Catwalk + Short A
      [[-1200,3346],[-400,3346],[-400,2600],[-1200,2600]],
      // A site
      [[-400,3346],[500,3346],[500,2400],[-400,2400]],
      // CT spawn
      [[500,2800],[1444,2800],[1444,1800],[500,1800]],
      // Mid + CT mid
      [[-600,2400],[500,2400],[500,1400],[-600,1400]],
      // Short / catwalk upper
      [[-200,3200],[500,3200],[500,2800],[-200,2800]],
      // T spawn
      [[-2476,1600],[-800,1600],[-800,800],[-2476,800]],
      // B tunnels upper
      [[-2476,2200],[-1600,2200],[-1600,1600],[-2476,1600]],
      // B tunnels lower
      [[-2476,600],[-1400,600],[-1400,-200],[-2476,-200]],
      // B site
      [[-2476,-200],[-800,-200],[-800,-1228],[-2476,-1228]],
      // B platform
      [[-1800,-200],[-800,-200],[-800,400],[-1800,400]],
      // Doors / mid lower
      [[-800,1600],[-200,1600],[-200,800],[-800,800]],
      // Lower mid
      [[-200,1400],[500,1400],[500,800],[-200,800]],
    ],
    // Obstacles / boîtes (rects simples)
    boxes: [
      // A site boxes
      {x:-200,y:2600,w:150,h:120},
      {x:100,y:2800,w:120,h:100},
      {x:200,y:2500,w:100,h:80},
      // B site boxes
      {x:-2200,y:-800,w:200,h:150},
      {x:-1800,y:-600,w:150,h:120},
      {x:-1600,y:-900,w:120,h:100},
      // Mid boxes
      {x:-400,y:1600,w:100,h:80},
      {x:-100,y:1200,w:80,h:60},
    ],
    // Labels zones
    labels: [
      { text:'A', x: 50,  y: 2900, color:'#FF5500' },
      { text:'B', x:-1800,y:-600,  color:'#FF5500' },
      { text:'CT', x: 900, y:2300, color:'#4A9EFF' },
      { text:'T',  x:-1800,y:1200, color:'#FFB800' },
      { text:'MID',x:-100, y:1600, color:'#888' },
      { text:'LONG A', x:-1800,y:3100, color:'#888' },
      { text:'SHORT', x:-700,y:3100, color:'#888' },
      { text:'TUNNELS', x:-2000,y:2000, color:'#888' },
    ]
  },

  de_mirage: {
    bounds: { minX: -3230, maxX: 870, minY: -2750, maxY: 930 },
    floors: [
      // T spawn
      [[-3230,-2750],[-1800,-2750],[-1800,-1800],[-3230,-1800]],
      // Mid
      [[-1800,-1200],[-400,-1200],[-400,-400],[-1800,-400]],
      // A site
      [[-400,930],[870,930],[870,-400],[-400,-400]],
      // A ramp / palace
      [[-1800,930],[-400,930],[-400,0],[-1800,0]],
      // CT spawn
      [[0,930],[870,930],[870,0],[0,0]],
      // B short
      [[-3230,-400],[-1800,-400],[-1800,-1200],[-3230,-1200]],
      // B site
      [[-3230,-1200],[-1800,-1200],[-1800,-2000],[-3230,-2000]],
      // Connector
      [[-400,-400],[0,-400],[0,-1200],[-400,-1200]],
    ],
    boxes: [
      {x:-200,y:200,w:150,h:100},
      {x:100,y:400,w:120,h:80},
      {x:-2800,y:-1600,w:180,h:120},
      {x:-2400,y:-1400,w:140,h:100},
      {x:-1000,y:-800,w:100,h:80},
    ],
    labels: [
      { text:'A',  x: 200, y: 400,  color:'#FF5500' },
      { text:'B',  x:-2400,y:-1600, color:'#FF5500' },
      { text:'CT', x: 500, y: 600,  color:'#4A9EFF' },
      { text:'T',  x:-2600,y:-2200, color:'#FFB800' },
      { text:'MID',x:-1100,y:-800,  color:'#888' },
      { text:'RAMP',x:-1200,y:400,  color:'#888' },
    ]
  },

  de_inferno: {
    bounds: { minX: -2087, maxX: 2870, minY: -1200, maxY: 3110 },
    floors: [
      // T spawn
      [[-2087,3110],[-400,3110],[-400,2200],[-2087,2200]],
      // A site
      [[600,3110],[2870,3110],[2870,2000],[600,2000]],
      // B site
      [[-2087,800],[0,800],[0,-400],[-2087,-400]],
      // CT spawn
      [[1200,2000],[2870,2000],[2870,800],[1200,800]],
      // Mid / banana
      [[-400,2200],[600,2200],[600,1200],[-400,1200]],
      // Apartments
      [[-400,3110],[600,3110],[600,2200],[-400,2200]],
      // B apartments
      [[-2087,2200],[-400,2200],[-400,1600],[-2087,1600]],
      // Second mid
      [[600,2000],[1200,2000],[1200,1000],[600,1000]],
    ],
    boxes: [
      {x:800,y:2400,w:150,h:100},
      {x:1200,y:2600,w:120,h:80},
      {x:-1600,y:200,w:180,h:120},
      {x:-1200,y:400,w:140,h:100},
    ],
    labels: [
      { text:'A',   x:1600, y:2600, color:'#FF5500' },
      { text:'B',   x:-1200,y:200,  color:'#FF5500' },
      { text:'CT',  x:2000, y:1400, color:'#4A9EFF' },
      { text:'T',   x:-1400,y:2800, color:'#FFB800' },
      { text:'BANANA', x:100,y:1600, color:'#888' },
      { text:'APPS',x:-400,y:2800,  color:'#888' },
    ]
  },

  de_ancient: {
    bounds: { minX: -2953, maxX: 2164, minY: -1600, maxY: 3200 },
    floors: [
      [[-2953,3200],[-800,3200],[-800,2000],[-2953,2000]],
      [[400,3200],[2164,3200],[2164,2000],[400,2000]],
      [[-2953,400],[0,400],[0,-600],[-2953,-600]],
      [[800,2000],[2164,2000],[2164,600],[800,600]],
      [[-800,2000],[400,2000],[400,1000],[-800,1000]],
      [[-800,3200],[400,3200],[400,2000],[-800,2000]],
    ],
    boxes: [
      {x:600,y:2400,w:150,h:120},
      {x:1000,y:2600,w:120,h:100},
      {x:-2200,y:0,w:180,h:120},
    ],
    labels: [
      { text:'A',  x:1200, y:2600, color:'#FF5500' },
      { text:'B',  x:-1600,y:0,    color:'#FF5500' },
      { text:'CT', x:1600, y:1200, color:'#4A9EFF' },
      { text:'T',  x:-1800,y:2800, color:'#FFB800' },
      { text:'MID',x:-200, y:1600, color:'#888' },
    ]
  },

  de_nuke: {
    bounds: { minX: -3453, maxX: 2497, minY: -3000, maxY: 2200 },
    floors: [
      // T spawn
      [[-3453,2200],[-1200,2200],[-1200,1200],[-3453,1200]],
      // Upper site
      [[-800,2200],[800,2200],[800,400],[-800,400]],
      // Lower site (approximation)
      [[-800,400],[800,400],[800,-600],[-800,-600]],
      // CT spawn
      [[800,2200],[2497,2200],[2497,400],[800,400]],
      // Ramp
      [[-1200,1200],[-800,1200],[-800,400],[-1200,400]],
      // Outside
      [[-3453,400],[-1200,400],[-1200,-600],[-3453,-600]],
      // Secret
      [[-800,-600],[800,-600],[800,-1600],[-800,-1600]],
      // Sewer
      [[-3453,-600],[-800,-600],[-800,-1600],[-3453,-1600]],
    ],
    boxes: [
      {x:-400,y:1600,w:200,h:150},
      {x:0,y:1200,w:150,h:120},
      {x:-400,y:0,w:150,h:100},
    ],
    labels: [
      { text:'A',   x: 0,   y:1600, color:'#FF5500' },
      { text:'B',   x: 0,   y:0,    color:'#FF5500' },
      { text:'CT',  x:1600, y:1400, color:'#4A9EFF' },
      { text:'T',   x:-2400,y:1800, color:'#FFB800' },
      { text:'RAMP',x:-1000,y:800,  color:'#888' },
      { text:'SECRET',x:-200,y:-1000,color:'#888' },
    ]
  },

  de_anubis: {
    bounds: { minX: -2100, maxX: 2500, minY: -2000, maxY: 2700 },
    floors: [
      [[-2100,2700],[-600,2700],[-600,1600],[-2100,1600]],
      [[400,2700],[2500,2700],[2500,1400],[400,1400]],
      [[-2100,200],[200,200],[200,-800],[-2100,-800]],
      [[800,1400],[2500,1400],[2500,200],[800,200]],
      [[-600,1600],[400,1600],[400,600],[-600,600]],
      [[-600,2700],[400,2700],[400,1600],[-600,1600]],
    ],
    boxes: [
      {x:600,y:2000,w:150,h:120},
      {x:1000,y:2200,w:120,h:100},
      {x:-1600,y:-200,w:180,h:120},
    ],
    labels: [
      { text:'A',  x:1400, y:2200, color:'#FF5500' },
      { text:'B',  x:-1400,y:-200, color:'#FF5500' },
      { text:'CT', x:1800, y:800,  color:'#4A9EFF' },
      { text:'T',  x:-1600,y:2200, color:'#FFB800' },
      { text:'MID',x:-100, y:1200, color:'#888' },
    ]
  },

  de_vertigo: {
    bounds: { minX: -3168, maxX: 1886, minY: -3316, maxY: 1740 },
    floors: [
      [[-3168,1740],[-800,1740],[-800,800],[-3168,800]],
      [[200,1740],[1886,1740],[1886,400],[200,400]],
      [[-3168,-400],[0,-400],[0,-1400],[-3168,-1400]],
      [[400,400],[1886,400],[1886,-600],[400,-600]],
      [[-800,800],[200,800],[200,-200],[-800,-200]],
      [[-800,1740],[200,1740],[200,800],[-800,800]],
    ],
    boxes: [
      {x:400,y:1000,w:150,h:120},
      {x:800,y:1200,w:120,h:100},
      {x:-2400,y:-800,w:180,h:120},
    ],
    labels: [
      { text:'A',  x: 900, y:1200, color:'#FF5500' },
      { text:'B',  x:-2000,y:-800, color:'#FF5500' },
      { text:'CT', x:1200, y:600,  color:'#4A9EFF' },
      { text:'T',  x:-2400,y:1300, color:'#FFB800' },
      { text:'MID',x:-300, y:400,  color:'#888' },
    ]
  }
};

// ── Renderer principal ─────────────────────────────────────────────────────
function drawMapBackground(ctx, mapName, W, H) {
  const map = CS2_MAPS[mapName];
  if (!map) {
    // Map inconnue — fond simple
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2A3040';
    ctx.fillRect(20, 20, W-40, H-40);
    ctx.fillStyle = '#4A6580';
    ctx.font = '500 14px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(mapName || 'map inconnue', W/2, H/2);
    return;
  }

  const { bounds, floors, boxes, labels } = map;

  // Conversion monde → canvas
  function wx(x) { return ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * W; }
  function wy(y) { return (1 - (y - bounds.minY) / (bounds.maxY - bounds.minY)) * H; }

  // Fond noir (murs)
  ctx.fillStyle = '#0A0C10';
  ctx.fillRect(0, 0, W, H);

  // Dessin des zones jouables
  ctx.fillStyle = '#1E2530';
  floors.forEach(poly => {
    ctx.beginPath();
    ctx.moveTo(wx(poly[0][0]), wy(poly[0][1]));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(wx(poly[i][0]), wy(poly[i][1]));
    }
    ctx.closePath();
    ctx.fill();
  });

  // Contours zones jouables
  ctx.strokeStyle = '#2E3A4A';
  ctx.lineWidth = 0.8;
  floors.forEach(poly => {
    ctx.beginPath();
    ctx.moveTo(wx(poly[0][0]), wy(poly[0][1]));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(wx(poly[i][0]), wy(poly[i][1]));
    }
    ctx.closePath();
    ctx.stroke();
  });

  // Boîtes / obstacles
  ctx.fillStyle = '#141820';
  if (boxes) {
    boxes.forEach(b => {
      const x1 = wx(b.x), y1 = wy(b.y + b.h);
      const x2 = wx(b.x + b.w), y2 = wy(b.y);
      ctx.fillRect(x1, y1, x2-x1, y2-y1);
      ctx.strokeStyle = '#2E3A4A';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x1, y1, x2-x1, y2-y1);
    });
  }

  // Labels zones
  if (labels) {
    labels.forEach(l => {
      const px = wx(l.x), py = wy(l.y);
      const isMainZone = ['A','B','CT','T'].includes(l.text);

      if (isMainZone) {
        // Badge coloré pour les zones principales
        const bw = l.text === 'CT' ? 34 : 28;
        const bh = 20;
        ctx.fillStyle = l.color + '33'; // 20% opacity
        ctx.beginPath();
        ctx.roundRect(px - bw/2, py - bh/2, bw, bh, 4);
        ctx.fill();
        ctx.strokeStyle = l.color + '88';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = l.color;
        ctx.font = `700 ${l.text.length > 2 ? 10 : 13}px DM Mono, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.text, px, py);
      } else {
        // Label secondaire discret
        ctx.fillStyle = l.color;
        ctx.font = '500 9px DM Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.text, px, py);
      }
    });
  }
}

// Export global
window.CS2_MAPS = CS2_MAPS;
window.drawMapBackground = drawMapBackground;
