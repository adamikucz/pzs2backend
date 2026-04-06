export default async function handler(req, res) {
    try {
        const response = await fetch("https://pzs2pszczyna.pl/zastepstwa");
        const html = await response.text();

        const match = html.match(/download=\d+:[^"]+/);

        if (!match) {
            return res.status(404).json({ error: "Brak PDF" });
        }

        const pdfUrl = "https://pzs2pszczyna.pl/zastepstwa?" + match[0];

        res.setHeader("Access-Control-Allow-Origin", "*");

        res.json({
            pdfUrl,
            updated: new Date().toISOString()
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}