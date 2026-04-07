export default async function handler(req, res) {
  try {
    const baseUrl = "https://pzs2pszczyna.pl/www/plan_lekcji/plany/";

    // Zakres do przeszukania (możesz zwiększyć jeśli kiedyś będzie więcej klas)
    const candidates = Array.from({ length: 60 }, (_, i) => `o${i + 1}`);

    const results = [];

    for (const id of candidates) {
      try {
        const url = `${baseUrl}${id}.html`;
        const response = await fetch(url, { method: "HEAD" });

        if (response.ok) {
          results.push({
            id,
            name: id.toUpperCase()
          });
        }
      } catch (e) {
        // ignorujemy błędy pojedynczych requestów
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({
      error: "Błąd wykrywania klas",
      details: err.message
    });
  }
}
