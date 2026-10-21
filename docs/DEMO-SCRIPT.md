# Demo script (2:30)

Every request below was typed into the simulator UI, in this order, in one headless Chromium run on 2026-10-21 with
`qwen2.5:7b`, and each produced the card described. Readings are live, so the numbers on the day of recording will
differ; the narration below does not quote numbers for that reason.

## Before recording

1. Start Ollama with `qwen2.5:7b`. Once the UI is up, send one throwaway question that changes nothing (for example
   "How is the air?") and reload the page before recording: the first turn can be slow, and a reload clears the
   transcript.
2. Start the server on a fresh household file so the run begins from the seeded Singapore home, for example
   `AAG_DATA_FILE=/tmp/aag-demo/household.json npm start -w @aag/mcp-server` (any new path works; the file is created
   on the first change).
3. `npm run dev -w @aag/simulator`, open `http://localhost:5173`, leave "Voice on".
4. Record the browser window only. No logos other than the page's own "Simulated Alexa+ experience" label, no music
   with a licence.

## Beats

| Time | Type this | What the screen shows | Narration (one line) |
| --- | --- | --- | --- |
| 0:00 to 0:12 | (nothing yet) | The display: clock, "Air now" strip, "Simulated Alexa+ experience" label | "This is Air and Allergy Guardian, a simulated Alexa+ experience running on a real MCP server." |
| 0:12 to 0:24 | `Who lives here?` | Household card: central Singapore; Mei asthma, Dev grass and birch pollen, Alex none | "It knows the household: who lives here and what affects each of them." |
| 0:24 to 0:38 | `Is it okay for Mei to go outside?` | Verdict card with live AQI, PM2.5, PM10, ozone, NO2 tiles and a verdict chip for Mei | "The answer is for Mei in particular, from live Open-Meteo readings and her asthma." |
| 0:38 to 0:56 | `How is the pollen for Dev right now?` | Verdict card with no pollen tiles; the card's sentence and Dev's chip both end with "pollen is not forecast for this location" | "Honest moment: Open-Meteo forecasts pollen for Europe only, so for Singapore it says so instead of guessing." |
| 0:56 to 1:06 | `Set home to Munich` | "Home is set to Munich, Germany" | "To show live pollen, we move the household to Munich." |
| 1:06 to 1:20 | `How is the pollen for Dev right now?` | Same card, now with six pollen tiles in grains per cubic metre | "Now the pollen tiles are real Munich values, close to zero this late in October." |
| 1:20 to 1:34 | `When is the best time for Dev to go for a run tomorrow?` | Best-time card: a two-hour window with its peak AQI | "It plans ahead, picking tomorrow's cleanest two-hour window for Dev's run." |
| 1:34 to 1:44 | `Dev has been sneezing a lot today` | "Symptom logged" card with the AQI at that moment | "Symptoms go into a diary, stamped with the air at that moment." |
| 1:44 to 1:54 | `Any symptoms logged recently?` | Diary card for the whole household with the average AQI at those times | "Ask about everyone and you get everyone." |
| 1:54 to 2:04 | `Warn Alex when the air quality index goes above 1` | "Alert set" card listing the rules | "Alerts are per person; this low threshold makes one fire right away for the demo." |
| 2:04 to 2:16 | (wait for the next poll; cut the wait and show a caption such as "seconds later") | Amber "Proactive alert" card, spoken without being asked | "Every 30 seconds the display checks the rules, and speaks up on its own when one trips." |
| 2:16 to 2:24 | `Clear the alert for Alex` | "Cleared one alert rule" card | "And clearing it is one sentence." |
| 2:24 to 2:30 | (nothing) | The full transcript of cards | "Air and Allergy Guardian: personal air and pollen advice for the whole household." |

## Notes from the verification run

- "Who lives here?", the first turn of the run, took about eight seconds; every later turn took under one and a half
  seconds. Hence the throwaway question before recording.
- The severity in the "Symptom logged" card can differ between runs (3 or 4 for "a lot"); the narration does not name it.
- The seeded household also has a rule for Mei (PM2.5 above 35). If Singapore's PM2.5 is above 35 on the day, a
  proactive alert for Mei can appear during the Singapore beats. It is real; keep it or re-record.
- The alert in the 2:04 beat appeared 19 seconds after the rule was set in the verification run; the wait is at most
  30 seconds.
