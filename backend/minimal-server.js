const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('Minimal Express server is running!');
});

app.listen(PORT, () => {
  console.log(`Minimal server running on http://localhost:${PORT}`);
});
