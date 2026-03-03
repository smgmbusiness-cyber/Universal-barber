const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'AI Phone Agent' });
});

app.post('/api/call/incoming', (req, res) => {
  const callId = uuidv4();
  const text = req.body.text || '';
  const lowerText = text.toLowerCase();

  let reply = 'Hei! Hvordan kan jeg hjelpe deg?';
  let action = 'AI_REPLY';

  // Hvis kunden vil snakke med ekte person
  if (
    lowerText.includes('menneske') ||
    lowerText.includes('person') ||
    lowerText.includes('snakke med noen') ||
    lowerText.includes('agent') ||
    lowerText.includes('ikke fornøyd')
  ) {
    reply = 'Jeg setter deg over til en medarbeider nå.';
    action = 'TRANSFER_TO_HUMAN';
  }

  // Vanlig AI-respons
  else if (lowerText.includes('rom')) {
    reply = 'Jeg kan hjelpe deg å booke et rom. Hvor mange netter?';
  }

  res.json({
    callId,
    reply,
    action,
  });
});


app.post('/api/booking/room', (req, res) => {
  res.json({
    bookingId: uuidv4(),
    status: 'CONFIRMED',
  });
});

app.listen(PORT, () => {
  console.log(`Server kjører på port ${PORT}`);
});

// START OUTBOUND CALL
app.post("/api/call/outbound", async (req, res) => {
  try {
    const { to_number, agent_id, from_number } = req.body;

    const response = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id,
        from_number,
        to_number,
      }),
    });

    const data = await response.json();
    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
