// ----------------------------------------------------------------------
// Configuration 
// ----------------------------------------------------------------------

const mqttConfig = {
  url: 'wss://y1884188.ala.us-east-1.emqxsl.com:8084/mqtt',
  options: {
    username: 'web',
    password: '123',
    //clientId: 'web-123' + Math.random().toString(16).slice(2, 10),
    clientId: 'web',
  },
};

const topic = 'nodes/+/data';

// ----------------------------------------------------------------------
// MQTT — subscribes directly from the browser over WebSocket, no backend
// ----------------------------------------------------------------------

const connectStatus = document.getElementById('connection-status');
const client = mqtt.connect(mqttConfig.url, mqttConfig.options, {
  reconnectPeriod: 5000
});


client.on('connect', () => {
  connectStatus.textContent = ' 🟢 Conectado al servidor';
  connectStatus.className = 'status status--connected';
  //client.subscribe(`${topicPrefix}/+/data`, { qos: 1 });
  //client.subscribe(topic, { qos: 1 });
  client.subscribe(topic, (err) => {
    if(err) {
      console.log("Subscribe error: ", err);
    }else{
      console.log("Subscribed to nodes/+/data");
    }
  })

});

client.on('reconnect', () => {
  connectStatus.textContent = ' 🟡 Reconectando al servidor';
  connectStatus.className = 'status status--connecting';
});

client.on('close', () => {
  connectStatus.textContent = ' 🔴 Conexion perdida con el servidor';
  connectStatus.className = 'status status--lost';
});

client.on('error', (err) => {
  console.error('MQTT error:', err);
});

client.on('message', (topic, payloadBuf) => {
          
  // topic shape: nodes/nodeId/+
  const parts = topic.split('/');
  const nodeId = parts[1];
  const kind = parts[2];
  if (!nodes[nodeId]) return; // ignore topics for nodes we don't know about

  const payload = payloadBuf.toString();

  if (kind === 'status') {
    nodeState[nodeId].online = payload === 'online';
    renderNode(nodeId);
    return;
  }

  if (kind === 'data') {
    try {
      const reading = JSON.parse(payload);
      nodeState[nodeId].temp = reading.temp;
      nodeState[nodeId].hum = reading.hum;
      nodeState[nodeId].ts = reading.ts;
      nodeState[nodeId].online = true;
      renderNode(nodeId);
    } catch (err) {
      console.error(`Error en payload en topic ${topic}:`, payload, err);
    }
  }
});

const nodes = {
  node1: { label: 'node1', name: 'INTA AER Villa Regina 1', lat: -39.0977, lon: -67.0973 },
  node2: { label: 'node2', name: 'INTA AER Villa Regina 2', lat: -39.0976, lon: -67.0974 },
  node3: { label: 'node3', name: 'E.E.A. Alto Valle', lat: -39.0235, lon: -67.7362 }, 
  node4: { label: 'node4', name: 'Centro Regional Patagonia Sur', lat: -43.2532, lon: -65.3109 }  
};

const mapCenter = [-67.1116, -39.1027]; // [lon, lat] 
const mapZoom = 11;

const NODE_OFFLINE_AFTER = 60; // seconds without data => node considered offline
const UI_REFRESH_INTERVAL = 10000;

// ----------------------------------------------------------------------
// Map
// ----------------------------------------------------------------------

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: 'Imagery &copy; Esri',
      },
    },
    layers: [
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
      },
    ],
  },
  center: mapCenter,
  zoom: mapZoom,
});

map.addControl(
  new maplibregl.NavigationControl(),
  'top-right'
);


// ======================================================================
// Node state
// ======================================================================
//
// This is the source of truth for the frontend.
//
// MQTT should update this object.
// The map and side panel only READ from it.
//
// Example:
//
// nodeState[nodeId] = {
//   temp: 23.4,
//   hum: 61.2,
//   ts: 1727080000,
//   online: true
// }
// ======================================================================

const nodeState = {};

for (const nodeId of Object.keys(nodes)) {
  nodeState[nodeId] = {
    temp: null,
    hum: null,
    ts: null,
    online: false,
  };
}

// ======================================================================
// Map objects
// ======================================================================

const markers = {};   // nodeId -> maplibregl.Marker
const popups = {};    // nodeId -> maplibregl.Popup


// ======================================================================
// Helpers
// ======================================================================

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTemperature(value) {
  return value != null
    ? `${value.toFixed(1)}&deg;C`
    : '—';
}

function formatHumidity(value) {
  return value != null
    ? `${value.toFixed(1)}%`
    : '—';
}

function relativeTime(unixSeconds) {
  if (unixSeconds == null) {
    return 'Esperando data...';
  }

  const seconds = Math.max(
    0,
    Math.floor(Date.now() / 1000 - unixSeconds)
  );

  if (seconds < 5) {
    return 'ultimo dato hace un momento';
  }

  if (seconds < 60) {
    return `utlimo dato hace ${seconds}s`;
  }

  if (seconds < 3600) {
    return `utlimo dato hace ${Math.floor(seconds / 60)}m`;
  }

  return `utlimo dato hace ${Math.floor(seconds / 3600)}h`;
}


// ======================================================================
// Node status
// ======================================================================
//
// A node is considered online when we received data recently.
//
// This is deliberately independent from the MQTT connection.
//
// Example:
//
// Internet/MQTT connected
//       +
// node hasn't sent data for 5 minutes
//       =
// node offline
//
// ======================================================================

function updateNodeOnlineStatus(nodeId) {
  const s = nodeState[nodeId];

  if (s.ts == null) {
    s.online = false;
    return;
  }

  const age = Date.now() / 1000 - s.ts;

  s.online = age <= NODE_OFFLINE_AFTER;
}

// ======================================================================
// Popup
// ======================================================================

function popupHTML(nodeId) {
  const node = nodes[nodeId];
  const s = nodeState[nodeId];

  const name = escapeHTML(node.name);

  return `
    <div class="popup-name">${name}</div>

    <div class="popup-readings">
      <span>${formatTemperature(s.temp)}</span>
      <span>${formatHumidity(s.hum)}</span>
    </div>

    <div class="popup-updated">
      ${relativeTime(s.ts)}
    </div>
  `;
}


// ======================================================================
// Create markers
// ======================================================================

for (const [nodeId, node] of Object.entries(nodes)) {

  const el = document.createElement('div');

  el.className = 'sensor-marker';

  const popup = new maplibregl.Popup({
    offset: 14,
    closeButton: true,
  })
    .setHTML(popupHTML(nodeId));


  const marker = new maplibregl.Marker({
    element: el,
  })
    .setLngLat([node.lon, node.lat])
    .setPopup(popup)
    .addTo(map);


  markers[nodeId] = marker;
  popups[nodeId] = popup;
}


// ======================================================================
// Side panel
// ======================================================================

const panel = document.getElementById("panel");
const button = document.getElementById("togglePanel");

button.addEventListener("click", () => {
  panel.classList.toggle("open");
  button.classList.toggle("open");
});

const nodeList = document.getElementById('node-list');

for (const [nodeId, node] of Object.entries(nodes)) {

  const card = document.createElement('div');

  card.className = 'node-card';
  card.id = `card-${nodeId}`;

  card.innerHTML = `
    <div class="row">
      <span class="name">${escapeHTML(node.name)}</span>
      <span class="dot" id="dot-${nodeId}"></span>
    </div>

    <div class="readings">

      <div class="reading temp">
        <span
          class="value"
          id="temp-${nodeId}"
        >—</span>

        <span class="unit">&deg;C</span>

        <div class="label">
          Temperatura
        </div>
      </div>


      <div class="reading hum">
        <span
          class="value"
          id="hum-${nodeId}"
        >—</span>

        <span class="unit">%</span>

        <div class="label">
          Humedad
        </div>
      </div>

    </div>

    <div class="updated" id="updated-${nodeId}">
      Esperando datos...
    </div>
  `;

  card.addEventListener('click', () => {

    map.flyTo({
      center: [node.lon, node.lat],
      zoom: 14,
    });

    popups[nodeId].addTo(map);
  });

  nodeList.appendChild(card);
}

// ======================================================================
// Render one node
// ======================================================================
//
// This is the ONLY function that should update the visual state of a node.
//
// MQTT should NOT manipulate DOM elements directly.
//
// Instead:
//
// MQTT message
//      ↓
// updateNode()
//      ↓
// renderNode()
//      ↓
// map + side panel
// ======================================================================

function renderNode(nodeId) {

  const s = nodeState[nodeId];

  if (!s) {
    console.warn(`Unknown node: ${nodeId}`);
    return;
  }

  // --------------------------------------------------
  // Update online status
  // --------------------------------------------------

  updateNodeOnlineStatus(nodeId);

  // --------------------------------------------------
  // Side panel readings
  // --------------------------------------------------

  const tempEl = document.getElementById(`temp-${nodeId}`);

  const humEl = document.getElementById(`hum-${nodeId}`);

  const updatedEl = document.getElementById(`updated-${nodeId}`);

  tempEl.textContent =
    s.temp != null
      ? s.temp.toFixed(1)
      : '—';

  humEl.textContent =
    s.hum != null
      ? s.hum.toFixed(1)
      : '—';

  updatedEl.textContent =
    relativeTime(s.ts);

  // --------------------------------------------------
  // Online/offline indicator
  // --------------------------------------------------

  const dot = document.getElementById(`dot-${nodeId}`);

  dot.classList.toggle(
    'online',
    s.online === true
  );

  dot.classList.toggle(
    'offline',
    s.online === false
  );

  // --------------------------------------------------
  // Map marker
  // --------------------------------------------------

  markers[nodeId]
    .getElement()
    .classList.toggle(
      'offline',
      s.online === false
    );

  // --------------------------------------------------
  // Popup
  // --------------------------------------------------

  popups[nodeId].setHTML(
    popupHTML(nodeId)
  );
}

// ======================================================================
// Update node from MQTT
// ======================================================================
//
// This is the function your MQTT manager will call.
//
// For example:
//
// updateNode('node-01', {
//   temp: 23.5,
//   hum: 62.1,
//   ts: 1727080000
// });
//
// MQTT doesn't need to know anything about the map.
//
// ======================================================================

function updateNode(nodeId, data) {

  if (!nodeState[nodeId]) {
    console.warn(
      `Received data for unknown node: ${nodeId}`
    );

    return;
  }

  const s = nodeState[nodeId];

  if (data.temp !== undefined) {
    s.temp = data.temp;
  }

  if (data.hum !== undefined) {
    s.hum = data.hum;
  }

  if (data.ts !== undefined) {
    s.ts = data.ts;
  }

  renderNode(nodeId);
}


// ======================================================================
// Periodic UI refresh
// ======================================================================
//
// This does NOT receive MQTT data.
//
// It only refreshes things like:
//
// "just now"
// "12s ago"
// "2m ago"
//
// and recalculates node online/offline status.
// ======================================================================

setInterval(() => {

  for (const nodeId of Object.keys(nodes)) {
    renderNode(nodeId);
  }

}, UI_REFRESH_INTERVAL);
