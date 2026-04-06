export default async function handler(req, res) {
    try {
        const page = await fetch("https://pzs2pszczyna.pl/zastepstwa");
        const html = await page.text();

        const match = html.match(/download=\d+:[^"]+/);

        if (!match) {
            return res.status(404).json({ error: "Brak PDF" });
        }

        const pdfUrl = "https://pzs2pszczyna.pl/zastepstwa?" + match[0];

        // Pobieramy PDF
        const pdfResponse = await fetch(pdfUrl);
        const buffer = await pdfResponse.arrayBuffer();

        // 🔥 NAJWAŻNIEJSZE
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline"); // zamiast attachment
        res.setHeader("Access-Control-Allow-Origin", "*");

        res.send(Buffer.from(buffer));

    } catch (err) {
        res.status(500).send("Błąd serwera");
    }
}
