export default async function handler(req, res) {
    try {
        const page = await fetch("https://pzs2pszczyna.pl/zastepstwa");
        const html = await page.text();

        const match = html.match(/download=\d+:[^"]+/);

        if (!match) {
            return res.status(404).send("Brak PDF");
        }

        const pdfUrl = "https://pzs2pszczyna.pl/zastepstwa?" + match[0];

        const pdfResponse = await fetch(pdfUrl);

        // 🔥 KLUCZOWE HEADERY
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Access-Control-Allow-Origin", "*");

        // 🔥 KLUCZ: STREAM, nie buffer
        const arrayBuffer = await pdfResponse.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        res.status(200).end(uint8Array);

    } catch (err) {
        res.status(500).send("Błąd serwera");
    }
}
