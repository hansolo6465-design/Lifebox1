"use strict";
// Local development server: npm start
const app = require("./backend/main");
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LifeBox running on http://localhost:${PORT}`));
