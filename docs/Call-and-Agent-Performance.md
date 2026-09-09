# VoiceIQ scoring guide

How a call is scored, how an agent is scored, and which numbers appear on the agent page.

All scores are on a 0–100 scale unless noted. Sentiment is a separate view and is not part of these scores. Talk percentage is shown for context. It does not, by itself, decide quality.

---

## 1. What is included

A call counts as a **connect** when Freshcaller marks it as a connected conversation. Voicemails and missed calls are excluded. If the connected flag is missing on an older recording, a call of 30 seconds or less is treated as a voicemail and left out.

Only **analyzed connects** enter an average. A connect that has not been analyzed still counts on the Connects card.

Agent page cards use one **calendar quarter** in Asia/Kolkata:

| Quarter | Dates |
| --- | --- |
| Q1 | 1 Jan – 31 Mar |
| Q2 | 1 Apr – 30 Jun |
| Q3 | 1 Jul – 30 Sep |
| Q4 | 1 Oct – 31 Dec |

The page opens on the current quarter. When the quarter changes, the cards start again from the new quarter. Older calls stay in the database and can be opened from the quarter selector. Nothing is deleted.

**Appointment generated** means a reviewer set the call disposition to Appointment. That filter limits both the cards and the recording list to those calls, still inside the selected quarter.

---

## 2. Two different scores

These are not the same number.

| Score | What it measures | Where it is shown |
| --- | --- | --- |
| Call quality | How clear the recording is, and whether the agent’s speaking pace is usable | Call score on each row, and the Call quality card |
| Agent performance | How the agent handled the conversation, across seven behaviour categories | Performance card, and category averages |

A call can have a call quality score even when the performance score is missing. That happens if the behaviour model does not return a result, for example when it is rate-limited. Talk time and call quality are still saved.

---

## 3. Call quality

Used on the agent page and as the **Call score** on each recording row.

**Call quality = average of the parts that exist**

- Clarity, 50%
- Speech-rate score, 50%

If only one part exists, that part is used. If neither exists, the call is not included in the call-quality average.

### Clarity

Clarity is the speech-to-text confidence for the recording, shown as 0–100.

- Start from average word confidence × 100
- If confidence is missing, use 70
- If more than 35% of the call is silence, reduce the score by `0.6 × (silence % − 35)`
- Keep the result between 0 and 100

This is a clarity proxy for the recording. It is not a judgement of the agent’s product knowledge.

### Speech rate

Raw speech rate is the agent’s words per second:

**Words per second = agent words spoken ÷ agent talk time in seconds**

If talk time is missing, words per minute ÷ 60 is used.

The scored version uses this band:

| Agent words per second | Speech-rate score |
| --- | --- |
| 2.0 to 3.2 | 100 |
| Below 2.0 | Lose 25 points for each 0.5 words/s below 2.0 |
| Above 3.2 | Lose 25 points for each 0.5 words/s above 3.2 |
| No agent speech | Not scored |

The floor is 0. The raw words-per-second figure is still shown next to the score, so a manager can see the pace itself, not only the mark.

Example: 1.5 words/s is 0.5 below the band, so the speech-rate score is 75.  
Example: 2.7 words/s is inside the band, so the speech-rate score is 100.

### Call quality card

The card is the average call quality of analyzed connects in the selected quarter. The line under it shows the average clarity and the average speech-rate score for those same calls.

---

## 4. Agent performance

This is the score of how the agent conducted the call. It is calculated after the transcript exists. A behaviour model scores the agent on seven categories, each 0–100, with a short explanation and quoted evidence from the call.

Talk percentage is given to the model as context only. The instruction is explicit: speaking more or less is not, by itself, good or bad. An agent may talk more while explaining a solution. A customer may talk more while explaining a problem.

### Categories and weights

| Category | Weight | What it covers |
| --- | --- | --- |
| Communication | 20% | Clear, understandable language |
| Relevance | 20% | Answers match what the customer asked |
| Listening | 15% | The agent follows the customer and does not ignore what was said |
| Turn taking | 15% | Clean handovers, without talking over or stalling |
| Engagement | 10% | The agent stays present and keeps the conversation moving |
| Balance | 10% | Neither side is locked out of the conversation |
| Efficiency | 10% | The call moves toward a useful outcome without wasted loops |

**Agent performance for one call = weighted total of those seven scores, out of 100.**

Each category score is also out of 100. A missing category is treated as 0 only inside that call’s weighted total. It is not invented for the category average.

### Category averages

The Category averages panel is not a second weighting. It is the plain average of each category across the quarter.

**Category average = sum of that category’s scores ÷ number of analyzed connects that have a performance score**

The result is shown out of 100.

Rules:

- Only analyzed connects in the selected quarter are used.
- If Appointment generated is on, only Appointment calls are used.
- A call with no performance score is left out of every category average. It does not reduce the average.
- Each category is averaged on its own. Communication is not mixed with Listening.
- The weights above are used for the call’s performance score. They are not applied again on this panel.

Example, two scored connects in the quarter:

| Category | Call 1 | Call 2 | Average, out of 100 |
| --- | --- | --- | --- |
| Communication | 80 | 90 | (80 + 90) / 2 = 85 |
| Relevance | 70 | 80 | (70 + 80) / 2 = 75 |
| Listening | 60 | 80 | (60 + 80) / 2 = 70 |
| Turn taking | 75 | 85 | (75 + 85) / 2 = 80 |
| Engagement | 50 | 70 | (50 + 70) / 2 = 60 |
| Balance | 65 | 75 | (65 + 75) / 2 = 70 |
| Efficiency | 55 | 65 | (55 + 65) / 2 = 60 |

Call 1 performance, out of 100:

(80 × 0.20) + (70 × 0.20) + (60 × 0.15) + (75 × 0.15) + (50 × 0.10) + (65 × 0.10) + (55 × 0.10) = 70.0

The Performance card is the average of those call totals, not the average of the seven category averages.

Customer rows on a call are interaction notes. They are not employee scores and are not averaged into the agent.

### When performance is blank

If the behaviour model does not return scores, the performance card stays empty for those calls. Call quality, speech rate, and connects are unaffected. The call can be analyzed again later to fill the performance score.

---

## 5. Agent page cards

Each card is for the selected quarter, and for the Appointment filter if that is on.

| Card | Calculation |
| --- | --- |
| Performance | Average agent performance of analyzed connects that have a performance score |
| Call quality | Average call quality of analyzed connects that have a call quality score |
| Calls processed (connects) | Count of connected calls in the quarter. The line under it is how many of those have been analyzed |
| Speech rate | Average agent words per second on analyzed connects |

Unanalyzed connects do not pull an average down. They appear only in the connects count.

---

## 6. Other figures on the recording row

These are shown so a reviewer can see the call. They are not the quality score.

| Figure | Meaning |
| --- | --- |
| Talk % | Agent talk time as a share of total talk time |
| Interruptions | Times speech overlaps, counted from the transcript timing |
| Speech rate | Agent words per second, unrounded to the score band |
| Disposition | Set by a reviewer, not by the model |

Disposition values:

| Value | Meaning | Colour |
| --- | --- | --- |
| Hung up | Call ended by hang-up | Yellow |
| Not Interested | Customer is not interested | Yellow |
| Appointment | Appointment generated | Dark green |
| Follow up | Needs a follow-up | Light green |
| DNC | Do not call | Blue |
| Not set | Reviewer has not chosen one | No mark, and not treated as an appointment |

The model’s Successful / Unsuccessful / Unclear result is a separate call outcome. It is not the disposition and it is not the agent score.

---

## 7. What is deliberately not used

- Sentiment does not change call quality or agent performance.
- Talk percentage does not set the score by itself.
- The older mixed recording formula (fluency, energy, response time, and disconnect) is not the number on the agent call-quality card. That card uses clarity and speech rate only.
- Past quarters are not wiped when a new quarter starts.

---

## 8. Worked example

One analyzed connect in Q3:

- Clarity 96
- Agent speech rate 2.7 words/s, so speech-rate score 100
- Call quality = (96 + 100) / 2 = 98
- Seven category scores, each out of 100, combine with the weights above to a performance score of 81 out of 100

That call contributes 98 to call quality and 81 to performance. A second analyzed connect is averaged with it. A third connect that has not been analyzed increases the connects count only.

Category averages are calculated separately, each out of 100: add that category’s scores and divide by the number of scored connects. The worked table is in the Category averages section above.
