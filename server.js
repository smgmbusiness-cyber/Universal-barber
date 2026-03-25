require("dotenv").config();
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const twilio = require("twilio");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

// ========= ENV =========
// PORT=3000
// SALON_NAME=Støtvik Barber
// SALON_PHONE=+4791111111              // nummeret salongen skal motta SMS på
// TWILIO_SMS_FROM=+1XXXXXXXXXX         // Twilio-nummer som sender SMS
// TWILIO_ACCOUNT_SID=...
// TWILIO_AUTH_TOKEN=...
// RETELL_WEBHOOK_SECRET=optional       // hvis dere senere vil verifisere signatur
//
// Merk:
// - TWILIO_SMS_FROM må være et Twilio-nummer som faktisk kan sende SMS
// - i produksjon bør dere bruke database, ikke Map()

const {
  SALON_NAME = "Demo Barber",
  SALON_PHONE,
  TWILIO_SMS_FROM,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
} = process.env;

if (!SALON_PHONE) {
  console.warn("Missing SALON_PHONE in environment variables.");
}
if (!TWILIO_SMS_FROM) {
  console.warn("Missing TWILIO_SMS_FROM in environment variables.");
}
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  console.warn("Twilio credentials are missing.");
}

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// Midlertidig lagring for MVP.
// callStore[callId] = { customerName, customerPhone, requestedService, requestedTime, notes, ... }
const callStore = new Map();

function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/[^\d+]/g, "");
}

function getOrCreateCall(callId) {
  if (!callStore.has(callId)) {
    callStore.set(callId, {
      callId,
      createdAt: new Date().toISOString(),
      customerName: null,
      customerPhone: null,
      requestedService: null,
      requestedTime: null,
      notes: null,
      transcript: null,
      endedAt: null,
    });
  }
  return callStore.get(callId);
}

function buildSalonSms(call) {
  const parts = [
    `Ny bookingforespørsel til ${SALON_NAME}.`,
    call.customerName ? `Navn: ${call.customerName}.` : null,
    call.customerPhone ? `Tlf: ${call.customerPhone}.` : null,
    call.requestedService ? `Ønsker: ${call.requestedService}.` : null,
    call.requestedTime ? `Tid: ${call.requestedTime}.` : null,
    call.notes ? `Notat: ${call.notes}.` : null,
  ];

  return parts.filter(Boolean).join("\n");
}

async function sendSmsToSalon(body) {
  if (!twilioClient) {
    throw new Error("Twilio client is not configured.");
  }
  if (!TWILIO_SMS_FROM) {
    throw new Error("TWILIO_SMS_FROM is missing.");
  }
  if (!SALON_PHONE) {
    throw new Error("SALON_PHONE is missing.");
  }

  const msg = await twilioClient.messages.create({
    from: TWILIO_SMS_FROM,
    to: SALON_PHONE,
    body,
  });

  return {
    sid: msg.sid,
    status: msg.status,
  };
}

// ========= HEALTH =========
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "salon-ai-receptionist",
    salon: SALON_NAME,
    smsConfigured: Boolean(
      TWILIO_ACCOUNT_SID &&
        TWILIO_AUTH_TOKEN &&
        TWILIO_SMS_FROM &&
        SALON_PHONE
    ),
  });
});

// ========= AGENT CONTEXT =========
// Kall denne fra Retell hvis dere vil gi agenten info om salongen.
app.get("/api/context", (req, res) => {
  res.json({
    salon_name: SALON_NAME,
    greeting: `Du er resepsjonist for ${SALON_NAME}.`,
    rules: [
      "Du skal aldri si at timen er bekreftet.",
      "Du skal si at salongen følger opp manuelt.",
      "Du skal samle inn navn, telefonnummer, type klipp/behandling og ønsket tidspunkt.",
      "Du skal være kort, hyggelig og tydelig på norsk.",
    ],
    services: [
      "Herreklipp",
      "Dameklipp",
      "Barneklipp",
      "Fade",
      "Skjeggtrim",
      "Hårklipp + skjegg",
    ],
  });
});

// ========= TOOL: SAVE BOOKING REQUEST =========
// Denne kan brukes som Retell Custom Function.
// Agenten kaller den når den har samlet inn det viktigste.
//
// Eksempel body:
// {
//   "call_id": "call_123",
//   "customer_name": "Ola Nordmann",
//   "customer_phone": "+4799999999",
//   "requested_service": "Fade",
//   "requested_time": "Fredag etter klokken 14",
//   "notes": "Foretrekker senior barber"
// }
app.post("/api/tools/save-booking-request", (req, res) => {
  const {
    call_id,
    customer_name,
    customer_phone,
    requested_service,
    requested_time,
    notes,
  } = req.body || {};

  if (!call_id) {
    return res.status(400).json({
      ok: false,
      error: "call_id is required",
    });
  }

  const call = getOrCreateCall(call_id);

  if (customer_name) call.customerName = customer_name;
  if (customer_phone) call.customerPhone = normalizePhone(customer_phone);
  if (requested_service) call.requestedService = requested_service;
  if (requested_time) call.requestedTime = requested_time;
  if (notes) call.notes = notes;

  callStore.set(call_id, call);

  return res.json({
    ok: true,
    message:
      "Bookingforespørsel lagret. Informer kunden om at salongen følger opp manuelt.",
    saved: {
      call_id: call.callId,
      customer_name: call.customerName,
      customer_phone: call.customerPhone,
      requested_service: call.requestedService,
      requested_time: call.requestedTime,
      notes: call.notes,
    },
  });
});

// ========= TOOL: GET CURRENT BOOKING REQUEST =========
// Nyttig til debugging eller hvis agenten vil bekrefte opplysninger.
app.get("/api/tools/booking-request/:callId", (req, res) => {
  const call = callStore.get(req.params.callId);

  if (!call) {
    return res.status(404).json({
      ok: false,
      error: "Call not found",
    });
  }

  res.json({
    ok: true,
    call,
  });
});

// ========= WEBHOOK: CALL COMPLETED =========
// Koble denne til Retell webhook for "call_ended" eller "call_analyzed".
// Retell webhooks sendes som POST med JSON-payload. Etter avsluttet/analysert call
// kan dere lese call-data og sende SMS.
//
// Denne håndterer flere vanlige feltnavn defensivt.
app.post("/api/webhooks/retell-call-completed", async (req, res) => {
  try {
    const payload = req.body || {};
    console.log("Webhook received:", JSON.stringify(payload, null, 2));

    const eventType = payload.event_type || payload.event || null;

    const callId =
      payload.call_id ||
      payload.callId ||
      payload?.call?.call_id ||
      payload?.call?.callId;

    if (!callId) {
      return res.status(400).json({
        ok: false,
        error: "No call_id found in payload",
      });
    }

    const call = getOrCreateCall(callId);

    call.endedAt = new Date().toISOString();

    // Hent transcript/summary hvis tilgjengelig
    call.transcript =
      payload.transcript ||
      payload.summary ||
      payload?.call?.transcript ||
      payload?.call?.call_analysis?.call_summary ||
      payload?.call_analysis?.call_summary ||
      null;

    // Hvis dere senere bruker post-call analysis til å extracte structured fields,
    // kan dere også oppdatere customerName/requestedService/requestedTime her.
    // Retell har webhook-støtte for call analysis etter call er ferdig.

    // Ikke send SMS hvis vi mangler minimumsinformasjon
    const hasUsefulData =
      call.customerName ||
      call.customerPhone ||
      call.requestedService ||
      call.requestedTime;

    if (!hasUsefulData) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "No booking data stored for this call",
        event_type: eventType,
        call_id: callId,
      });
    }

    const smsBody = buildSalonSms(call);
    const smsResult = await sendSmsToSalon(smsBody);
    console.log("Sending SMS:", smsBody);

    callStore.set(callId, call);

    return res.json({
      ok: true,
      event_type: eventType,
      call_id: callId,
      sms_sent_to: SALON_PHONE,
      sms_body: smsBody,
      sms_result: smsResult,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// ========= OPTIONAL: MANUAL TEST ENDPOINT =========
// Brukes hvis dere vil teste SMS uten Retell først.
app.post("/api/test/send-sms", async (req, res) => {
  try {
    const {
      customer_name = "Test Kunde",
      customer_phone = "+4799999999",
      requested_service = "Fade",
      requested_time = "Fredag kl 14",
      notes = "Test fra endpoint",
    } = req.body || {};

    const fakeCall = {
      customerName: customer_name,
      customerPhone: normalizePhone(customer_phone),
      requestedService: requested_service,
      requestedTime: requested_time,
      notes,
    };

    const smsBody = buildSalonSms(fakeCall);
    const smsResult = await sendSmsToSalon(smsBody);

    res.json({
      ok: true,
      sms_body: smsBody,
      sms_result: smsResult,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
