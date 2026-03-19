const express = require("express");
const { v4: uuidv4 } = require("uuid");
const twilio = require("twilio");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

/**
 * ENV
 * ---
 * RETELL_API_KEY=...
 * TWILIO_ACCOUNT_SID=...
 * TWILIO_AUTH_TOKEN=...
 * TWILIO_SMS_FROM=+1....
 */
const {
  RETELL_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
} = process.env;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/**
 * -----------------------------
 * MULTI-TENANT CUSTOMER CONFIG
 * -----------------------------
 * Ett innnummer per kunde.
 * Bytt ut numre og data med deres ekte kunder.
 */

const CUSTOMERS = {
  "+372 5705 1857": {
    customerId: "customer_1",
    businessName: "Støtvik Barber",
    businessType: "barber",
    inboundNumber: "+37257051857",
    salonSmsNumber: "+4790102244",
    transferNumber: "+4790102244",
    language: "nb",
    timezone: "Europe/Oslo",
    address: "Eksempelveien 1, Oslo",
    openingHours: "Mandag-fredag 09:00-18:00, lørdag 10:00-16:00",
    services: [
      { code: "haircut", name: "Hårklipp", durationMin: 30, priceNok: 499 },
      { code: "fade", name: "Fade", durationMin: 45, priceNok: 599 },
      { code: "beard_trim", name: "Skjeggtrim", durationMin: 20, priceNok: 299 },
      { code: "haircut_beard", name: "Hårklipp + skjegg", durationMin: 50, priceNok: 699 }
    ]
  },

  "+37257051858": {
    customerId: "customer_2",
    businessName: "Bergen Barber Studio",
    businessType: "barber",
    inboundNumber: "+37257051858",
    salonSmsNumber: "+4792222222",
    transferNumber: "+4792222222",
    language: "nb",
    timezone: "Europe/Oslo",
    address: "Barbergata 10, Bergen",
    openingHours: "Mandag-fredag 10:00-19:00, lørdag 10:00-15:00",
    services: [
      { code: "haircut", name: "Hårklipp", durationMin: 30, priceNok: 529 },
      { code: "skin_fade", name: "Skin fade", durationMin: 45, priceNok: 649 },
      { code: "beard_trim", name: "Skjeggtrim", durationMin: 20, priceNok: 320 },
      { code: "lineup", name: "Lineup", durationMin: 15, priceNok: 220 }
    ]
  },

  "+37257051859": {
    customerId: "customer_3",
    businessName: "Oslo Cut & Style",
    businessType: "frisor",
    inboundNumber: "+37257051859",
    salonSmsNumber: "+4793333333",
    transferNumber: "+4793333333",
    language: "nb",
    timezone: "Europe/Oslo",
    address: "Sentrum 5, Oslo",
    openingHours: "Mandag-lørdag 09:00-20:00",
    services: [
      { code: "womens_cut", name: "Dameklipp", durationMin: 45, priceNok: 799 },
      { code: "mens_cut", name: "Herreklipp", durationMin: 30, priceNok: 549 },
      { code: "color", name: "Farging", durationMin: 90, priceNok: 1499 },
      { code: "wash_style", name: "Vask og styling", durationMin: 30, priceNok: 450 }
    ]
  },

  "+37257051860": {
    customerId: "customer_4",
    businessName: "Trondheim Fade House",
    businessType: "barber",
    inboundNumber: "+37257051860",
    salonSmsNumber: "+4794444444",
    transferNumber: "+4794444444",
    language: "nb",
    timezone: "Europe/Oslo",
    address: "Fadeveien 2, Trondheim",
    openingHours: "Tirsdag-søndag 11:00-19:00",
    services: [
      { code: "fade", name: "Fade", durationMin: 40, priceNok: 589 },
      { code: "buzzcut", name: "Buzzcut", durationMin: 20, priceNok: 299 },
      { code: "beard_trim", name: "Skjeggtrim", durationMin: 20, priceNok: 299 },
      { code: "haircut_beard", name: "Hårklipp + skjegg", durationMin: 50, priceNok: 699 }
    ]
  },

  "+37257051861": {
    customerId: "customer_5",
    businessName: "Stavanger Hair Lounge",
    businessType: "frisor",
    inboundNumber: "+37257051861",
    salonSmsNumber: "+4795555555",
    transferNumber: "+4795555555",
    language: "nb",
    timezone: "Europe/Oslo",
    address: "Hårgata 7, Stavanger",
    openingHours: "Mandag-fredag 08:00-18:00",
    services: [
      { code: "mens_cut", name: "Herreklipp", durationMin: 30, priceNok: 499 },
      { code: "womens_cut", name: "Dameklipp", durationMin: 50, priceNok: 849 },
      { code: "color", name: "Farging", durationMin: 120, priceNok: 1699 },
      { code: "extensions_consult", name: "Extensions konsultasjon", durationMin: 30, priceNok: 0 }
    ]
  }
};

/**
 * -----------------------------
 * IN-MEMORY STATE
 * -----------------------------
 * For pilot/testing. I prod bør dette være Postgres/Redis.
 */
const calls = new Map();
/**
 * calls.set(callId, {
 *   callId,
 *   customerId,
 *   inboundNumber,
 *   callerNumber,
 *   createdAt,
 *   requestedService,
 *   requestedTime,
 *   customerName,
 *   notes,
 *   transferRequested,
 *   transcript,
 *   endedAt
 * })
 */

/**
 * -----------------------------
 * HELPERS
 * -----------------------------
 */

function normalizePhone(input) {
  if (!input) return "";
  return String(input).replace(/[^\d+]/g, "");
}

function getCustomerByInboundNumber(phoneNumber) {
  return CUSTOMERS[normalizePhone(phoneNumber)] || null;
}

function findCustomerById(customerId) {
  return Object.values(CUSTOMERS).find(c => c.customerId === customerId) || null;
}

function getServiceListForPrompt(customer) {
  return customer.services
    .map(s => `${s.name} (${s.durationMin} min, ${s.priceNok} kr)`)
    .join(", ");
}

function buildSystemContext(customer, callerNumber) {
  return {
    customerId: customer.customerId,
    businessName: customer.businessName,
    businessType: customer.businessType,
    address: customer.address,
    openingHours: customer.openingHours,
    transferNumber: customer.transferNumber,
    callerNumber,
    services: customer.services,
    instruction: `
Du er telefonassistent for ${customer.businessName}.
Du snakker norsk, kort og tydelig.
Du hjelper med:
- timebestilling
- spørsmål om priser
- spørsmål om åpningstider
- adresse
- sette over til menneske ved behov

Viktige regler:
- Ikke finn på priser eller behandlinger som ikke finnes i listen.
- Hvis kunde vil bestille time, samle inn:
  1. navn
  2. ønsket behandling
  3. ønsket dag/tid
  4. telefonnummer hvis nødvendig
- Når du har nok informasjon, kall booking-verktøyet.
- Hvis kunden vil snakke med en ansatt, kall transfer-verktøyet.
- Hvis kunden er usikker, spør ett spørsmål om gangen.

Tilgjengelige behandlinger:
${getServiceListForPrompt(customer)}

Åpningstider:
${customer.openingHours}

Adresse:
${customer.address}
    `.trim()
  };
}

async function sendSmsToSalon(to, body) {
  if (!twilioClient) {
    console.warn("Twilio client is not configured, SMS not sent.");
    return { skipped: true, reason: "TWILIO_NOT_CONFIGURED" };
  }

  if (!TWILIO_SMS_FROM) {
    console.warn("TWILIO_SMS_FROM missing, SMS not sent.");
    return { skipped: true, reason: "TWILIO_SMS_FROM_MISSING" };
  }

  const message = await twilioClient.messages.create({
    from: TWILIO_SMS_FROM,
    to,
    body
  });

  return {
    sid: message.sid,
    status: message.status
  };
}

function ensureCallRecord({
  callId,
  customerId,
  inboundNumber,
  callerNumber
}) {
  const existing = calls.get(callId);
  if (existing) return existing;

  const record = {
    callId,
    customerId,
    inboundNumber,
    callerNumber,
    createdAt: new Date().toISOString(),
    requestedService: null,
    requestedTime: null,
    customerName: null,
    notes: null,
    transferRequested: false,
    transcript: null,
    endedAt: null
  };

  calls.set(callId, record);
  return record;
}

function buildSalonSms({ customer, call }) {
  const pieces = [
    `Ny AI-henvendelse til ${customer.businessName}.`,
    call.customerName ? `Navn: ${call.customerName}.` : null,
    call.callerNumber ? `Telefon: ${call.callerNumber}.` : null,
    call.requestedService ? `Ønsker: ${call.requestedService}.` : null,
    call.requestedTime ? `Tidspunkt: ${call.requestedTime}.` : null,
    call.notes ? `Notat: ${call.notes}.` : null,
    call.transferRequested ? `Kunden ønsket å snakke med en ansatt.` : null
  ];

  return pieces.filter(Boolean).join(" ");
}

/**
 * -----------------------------
 * HEALTH
 * -----------------------------
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "multi-tenant-ai-phone-agent",
    customersLoaded: Object.keys(CUSTOMERS).length,
    smsEnabled: Boolean(twilioClient && TWILIO_SMS_FROM)
  });
});

/**
 * -----------------------------
 * CUSTOMER LOOKUP / CONTEXT
 * -----------------------------
 * Dette er endpointet agenten/webhooken kan bruke for
 * å hente riktig kundeinfo basert på nummeret som er ringt.
 *
 * Forventet body:
 * {
 *   "call_id": "abc",
 *   "to_number": "+37257051857",
 *   "from_number": "+4799999999"
 * }
 */
app.post("/api/call/context", (req, res) => {
  const callId = req.body.call_id || uuidv4();
  const toNumber = normalizePhone(req.body.to_number);
  const fromNumber = normalizePhone(req.body.from_number);

  const customer = getCustomerByInboundNumber(toNumber);

  if (!customer) {
    return res.status(404).json({
      ok: false,
      error: "No customer mapped to inbound number",
      to_number: toNumber
    });
  }

  const record = ensureCallRecord({
    callId,
    customerId: customer.customerId,
    inboundNumber: toNumber,
    callerNumber: fromNumber
  });

  const context = buildSystemContext(customer, fromNumber);

  res.json({
    ok: true,
    call_id: record.callId,
    customer_id: customer.customerId,
    business_name: customer.businessName,
    inbound_number: customer.inboundNumber,
    caller_number: fromNumber,
    context
  });
});

/**
 * -----------------------------
 * TOOL: REQUEST APPOINTMENT
 * -----------------------------
 * Kalles av agenten når den har samlet inn bookingønske.
 *
 * Body:
 * {
 *   "call_id": "...",
 *   "customer_id": "customer_1",
 *   "customer_name": "Ola Nordmann",
 *   "requested_service": "Fade",
 *   "requested_time": "Fredag kl 14:00",
 *   "notes": "Vil helst ha senior barber"
 * }
 */
app.post("/api/tools/request-appointment", (req, res) => {
  const {
    call_id,
    customer_id,
    customer_name,
    requested_service,
    requested_time,
    notes
  } = req.body;

  if (!call_id || !customer_id) {
    return res.status(400).json({
      ok: false,
      error: "call_id and customer_id are required"
    });
  }

  const customer = findCustomerById(customer_id);
  if (!customer) {
    return res.status(404).json({
      ok: false,
      error: "Unknown customer_id"
    });
  }

  const existing = calls.get(call_id) || ensureCallRecord({
    callId: call_id,
    customerId: customer_id,
    inboundNumber: customer.inboundNumber,
    callerNumber: null
  });

  existing.customerName = customer_name || existing.customerName;
  existing.requestedService = requested_service || existing.requestedService;
  existing.requestedTime = requested_time || existing.requestedTime;
  existing.notes = notes || existing.notes;

  calls.set(call_id, existing);

  return res.json({
    ok: true,
    status: "BOOKING_REQUEST_CAPTURED",
    message: `Bookingønske registrert hos ${customer.businessName}.`,
    booking_request: {
      call_id,
      customer_id,
      customer_name: existing.customerName,
      requested_service: existing.requestedService,
      requested_time: existing.requestedTime,
      notes: existing.notes
    }
  });
});

/**
 * -----------------------------
 * TOOL: TRANSFER TO HUMAN
 * -----------------------------
 * Kalles av agenten hvis kunden vil snakke med et menneske.
 *
 * Body:
 * {
 *   "call_id": "...",
 *   "customer_id": "customer_1",
 *   "reason": "Kunden ønsker å snakke med en ansatt"
 * }
 */
app.post("/api/tools/transfer-to-human", (req, res) => {
  const { call_id, customer_id, reason } = req.body;

  if (!call_id || !customer_id) {
    return res.status(400).json({
      ok: false,
      error: "call_id and customer_id are required"
    });
  }

  const customer = findCustomerById(customer_id);
  if (!customer) {
    return res.status(404).json({
      ok: false,
      error: "Unknown customer_id"
    });
  }

  const existing = calls.get(call_id) || ensureCallRecord({
    callId: call_id,
    customerId: customer_id,
    inboundNumber: customer.inboundNumber,
    callerNumber: null
  });

  existing.transferRequested = true;
  if (reason) {
    existing.notes = existing.notes
      ? `${existing.notes} | Transferårsaksnotat: ${reason}`
      : `Transferårsaksnotat: ${reason}`;
  }

  calls.set(call_id, existing);

  return res.json({
    ok: true,
    action: "TRANSFER_TO_HUMAN",
    transfer_number: customer.transferNumber,
    message: `Setter over til ${customer.businessName}.`
  });
});

/**
 * -----------------------------
 * OPTIONAL SIMPLE FAQ ROUTE
 * -----------------------------
 * Kan brukes hvis du vil la agenten slå opp svar.
 */
app.post("/api/tools/get-business-info", (req, res) => {
  const { customer_id } = req.body;

  if (!customer_id) {
    return res.status(400).json({ ok: false, error: "customer_id is required" });
  }

  const customer = findCustomerById(customer_id);
  if (!customer) {
    return res.status(404).json({ ok: false, error: "Unknown customer_id" });
  }

  res.json({
    ok: true,
    customer_id: customer.customerId,
    business_name: customer.businessName,
    address: customer.address,
    opening_hours: customer.openingHours,
    services: customer.services
  });
});

/**
 * -----------------------------
 * OUTBOUND CALL VIA RETELL
 * -----------------------------
 * Body:
 * {
 *   "to_number": "+4799999999",
 *   "agent_id": "agent_xxx",
 *   "from_number": "+37257051857"
 * }
 */
app.post("/api/call/outbound", async (req, res) => {
  try {
    if (!RETELL_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "RETELL_API_KEY is missing"
      });
    }

    const { to_number, agent_id, from_number } = req.body;

    if (!to_number || !agent_id || !from_number) {
      return res.status(400).json({
        ok: false,
        error: "to_number, agent_id and from_number are required"
      });
    }

    const response = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id,
        from_number,
        to_number
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        retell_error: data
      });
    }

    return res.json({
      ok: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * -----------------------------
 * CALL COMPLETED WEBHOOK
 * -----------------------------
 * Denne bør kobles til "call ended" / "post call" webhook.
 *
 * Poenget:
 * Når samtalen er ferdig, leser vi lagret bookingønske
 * og sender SMS til riktig salong.
 *
 * Mulig body fra Retell vil variere. Denne håndterer flere feltnavn:
 * - call_id / callId / call.call_id
 * - disconnection_reason
 * - transcript / call_analysis / summary
 */
app.post("/api/webhooks/call-completed", async (req, res) => {
  try {
    const payload = req.body || {};

    const callId =
      payload.call_id ||
      payload.callId ||
      payload?.call?.call_id ||
      payload?.call?.callId;

    if (!callId) {
      return res.status(400).json({
        ok: false,
        error: "No call_id found in webhook payload"
      });
    }

    const call = calls.get(callId);
    if (!call) {
      return res.status(404).json({
        ok: false,
        error: "No stored call record found for call_id",
        call_id: callId
      });
    }

    const customer = findCustomerById(call.customerId);
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: "Customer not found for stored call"
      });
    }

    call.endedAt = new Date().toISOString();
    call.transcript =
      payload.transcript ||
      payload?.call?.transcript ||
      payload.summary ||
      payload?.call_analysis?.call_summary ||
      null;

    // Hvis dere senere sender structured extraction fra Retell,
    // kan dere også oppdatere call.requestedService/requestedTime her.

    const smsBody = buildSalonSms({ customer, call });
    const smsResult = await sendSmsToSalon(customer.salonSmsNumber, smsBody);

    calls.set(callId, call);

    return res.json({
      ok: true,
      call_id: callId,
      sms_sent_to: customer.salonSmsNumber,
      sms_result: smsResult,
      sms_body: smsBody
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * -----------------------------
 * DEBUG ROUTES
 * -----------------------------
 */
app.get("/api/debug/customers", (req, res) => {
  res.json({
    ok: true,
    customers: Object.values(CUSTOMERS).map(c => ({
      customerId: c.customerId,
      businessName: c.businessName,
      inboundNumber: c.inboundNumber,
      salonSmsNumber: c.salonSmsNumber,
      serviceCount: c.services.length
    }))
  });
});

app.get("/api/debug/calls/:callId", (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call) {
    return res.status(404).json({ ok: false, error: "Call not found" });
  }

  res.json({
    ok: true,
    call
  });
});

app.listen(PORT, () => {
  console.log(`Server kjører på port ${PORT}`);
});
