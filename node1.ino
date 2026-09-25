
#include <Adafruit_Sensor.h>
#include <Adafruit_AHTX0.h>
#include <ArduinoJson.h>
#include <MQTT.h>
#include <time.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
//#include <WiFiClient.h>

// ---------------- config por nodo ----------------
const char* nodeId = "node1";
const float nodeLat = -39.1016;  
const float nodeLon = -67.1058;
const char* mqtt_user = "node1";  // give every node its own MQTT credentials
const char* mqtt_pass = "123";

// ---------------- wifi ----------------
const char* ssid = "Mas_Doria";
const char* pass = "GENETIk.78";

const char* server = "y1884188.ala.us-east-1.emqxsl.com";
const int port = 8883;  // 1883 = plain MQTT, 8883 = MQTT over TLS

const unsigned long PUBLISH_INTERVAL_MS = 10000;  // read + publish every 30s
unsigned long lastPublish = 0;

char topicData[64];
char topicStatus[64];

WiFiClientSecure wifiClient;
MQTTClient mqtt(512);  // bigger buffer than the 128-byte default, to fit the JSON payload
Adafruit_AHTX0 aht;

// ---------------- WiFi ----------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  Serial.print("Conectando a wifi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.println("Conectando a wifi...");
  }
  Serial.println(" -- Conectado, IP: " + WiFi.localIP().toString());
}

// ---------------- Time (for real unix timestamps in the payload ----------------
void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print(" -- Sincronizando tiempo ");
  time_t now = time(nullptr);
  while (now < 1700000000) {  // wait until it looks like a real epoch, not 1970
    delay(300);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println(" Listo --");
  Serial.print("Current time: ");
  Serial.println(ctime(&now));
}

// ---------------- conectamos al MQTT broker ------------------
void connectMQTT() {
  Serial.print(" - Conectando al MQTT broker ...");
  while (!mqtt.connect(nodeId, mqtt_user, mqtt_pass)) {
    Serial.println(".");
    delay(300);
  }
  Serial.println("... conectado! -");

  // Publish a retained "online" the moment we (re)connect.
  mqtt.publish(topicStatus, "online", true, 1);
}

void ahtInit() {
  // inicio Protocolo I2C para el sensor
  Wire.begin(21, 22);
  Wire.setClock(100000);

  Serial.println(" -- Inicializando I2C... ");

  // Init Sensor AHT10
  if (!aht.begin()) {
    Serial.println(" -- No se encontró el sensor AHT10 -- ");
    while (1) {
      delay(10);
    }
  }
  Serial.println(" AHT10 inicializado correctamente --");
}

void publishSensorData() {
  sensors_event_t humidity, temp;
  aht.getEvent(&humidity, &temp);

  JsonDocument doc;
  doc["node"] = nodeId;
  doc["temp"] = round(temp.temperature * 10) / 10.0;
  doc["hum"] = round(humidity.relative_humidity * 10) / 10.0;
  doc["lat"] = nodeLat;
  doc["lon"] = nodeLon;
  doc["ts"] = (unsigned long)time(nullptr);

  String payload;
  serializeJson(doc, payload);

  // retained = true -> a freshly loaded webpage sees the last reading
  // immediately, instead of waiting up to PUBLISH_INTERVAL_MS for the next one.
  mqtt.publish(topicData, payload, true, 1);

  Serial.println(payload);
}

void setup() {
  Serial.begin(115200);

  ahtInit();
  connectWiFi();

  syncTime();
  //wifiClient.setInsecure();
  mqtt.begin(server, port, wifiClient);

  snprintf(topicData, sizeof(topicData), "nodes/%s/data", nodeId);
  snprintf(topicStatus, sizeof(topicStatus), "nodes/%s/status", nodeId);
  mqtt.setWill(topicStatus, "offline", true, 1);  // Last Will: if this node drops off without disconnecting cleanly, the broker publishes this on its behalf - the website marks the node offline


  const char* root_ca = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
  )EOF";

  wifiClient.setCACert(root_ca);

  //wifiClient.setInsecure();  // DEV ONLY: skips certificate validation - pin EMQX's CA for production
}


void loop() {
  mqtt.loop();

  if (!mqtt.connected()) {
    connectMQTT();
  }

  if (millis() - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = millis();
    publishSensorData();
  }
}
