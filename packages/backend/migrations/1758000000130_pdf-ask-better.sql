-- Ask Better: reseed days from the author's PDF (source of truth).
-- Re-runnable: days cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'ask-better');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Matthew 16:15–16', 'The Teacher Who Asked'),
  (2, 'Matthew 7:7', 'Questions Are Seeds'),
  (3, 'Romans 12:2', 'Retire the Defeated Questions'),
  (4, 'Genesis 3:9', 'The God Who Asks “Where Are You?”'),
  (5, 'Proverbs 20:5', 'Go Deeper Than the First Answer'),
  (6, '1 Samuel 17:26', 'Question Your Assumptions'),
  (7, 'James 1:5', 'Ask for Wisdom — He Gives Generously'),
  (8, 'Psalm 25:4', 'The Six Questions of Destiny'),
  (9, 'Luke 11:8', 'Keep Knocking'),
  (10, 'Psalm 139:23–24', 'Search Me — the Prayer of the Open Life')
) AS v(n, ref, title) WHERE p.code = 'ask-better';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'ask-better'
JOIN (VALUES
  (1, 1, 'scripture', 'Today''s Reading', 'Matthew 16:15–16', $dev$““But what about you?” he asked. “Who do you say I am?” Simon Peter answered, “You are the Messiah, the Son of the living God.””$dev$),
  (1, 2, 'devotional', 'Devotional', NULL, $dev$At Caesarea Philippi, Jesus did not open with a lecture. He opened with a question — first the easy one (“Who do people say I am?”), then the one that changes lives: “Who do you say I am?”

Notice the sequence: question, then confession, then revelation, then keys. Peter's answer unlocked a blessing — “this was not revealed to you by flesh and blood, but by my Father in heaven” — and a destiny: the rock, the church, the keys of the kingdom.

Heaven still works this way. Revelation answers the man who dares to ask — and to be asked. So this plan begins where discipleship begins: let Jesus' question sit on you today, unhurried. Who do you say He is? Everything else you will ever ask stands on that answer.$dev$),
  (1, 3, 'talk', 'Talk it Over', NULL, $dev$— Who do you say Jesus is — in your own unborrowed words?

— How does your answer to that question shape every other question you ask?$dev$),
  (1, 4, 'devotional', 'Pray', NULL, $dev$Lord Jesus, You are the Messiah, the Son of the living God — my answer and my Answerer. Teach me this week to ask the way You taught: questions that open gates. Amen.

_May the greatest question ever asked find its firmest answer in you._$dev$),
  (1, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 16:13–20$dev$),
  (2, 1, 'scripture', 'Today''s Reading', 'Matthew 7:7', $dev$“Ask and it will be given to you; seek and you will find; knock and the door will be opened to you.”$dev$),
  (2, 2, 'devotional', 'Devotional', NULL, $dev$The direction of your life follows the direction of your questions. A question is a seed for an answer — plant it, and life begins arranging a harvest to match. Ask “how can I grow from this?” and your mind hunts growth. Ask “why does this always happen to me?” and your mind faithfully gathers evidence of doom.

Psychologists observe that the brain answers whatever it is asked — it is an obedient search engine. Scripture said it first and deeper: ask, seek, knock, and doors respond.

So take an audit today. Listen to the questions running under your thoughts like a soundtrack. They are seeds already in the soil. The good news of this whole plan: seeds can be exchanged, and a new planting can begin this very week.$dev$),
  (2, 3, 'talk', 'Talk it Over', NULL, $dev$— What three questions do you ask yourself most often? Write them down honestly.

— What harvest are those questions currently arranging?$dev$),
  (2, 4, 'devotional', 'Pray', NULL, $dev$Father, You have shown me that my questions are seeds. Walk with me through my inner soil this week — help me uproot what I never meant to plant. Amen.

_May every seed you plant with your questions grow into a harvest worth eating._$dev$),
  (2, 5, 'reading', 'Go Deeper', NULL, $dev$Matthew 7:7–11; Proverbs 4:23$dev$),
  (3, 1, 'scripture', 'Today''s Reading', 'Romans 12:2', $dev$“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”$dev$),
  (3, 2, 'devotional', 'Devotional', NULL, $dev$Some questions are accusations wearing the clothes of questions: Why can't I ever succeed? Why am I so unlucky? Why are all men — all women — the same? Why am I the only one facing such battles? They pretend to seek answers, but they have already ruled. The verdict is hidden inside the question.

These are circular circles of no change: the question assumes defeat, the answer confirms defeat, and a man walks the same road another year and calls it fate.

Today, hold a retirement ceremony. Name your defeated questions — out loud — and dismiss them from service. They have worked in your life long enough. Tomorrow we will hire their replacements; today, simply and firmly, let them go.$dev$),
  (3, 3, 'talk', 'Talk it Over', NULL, $dev$— Which defeated question has served longest in your inner life?

— What has it cost you across the years — in hope, in courage, in attempts?$dev$),
  (3, 4, 'devotional', 'Pray', NULL, $dev$Father, today I retire the questions that always ruled against me. I dismiss them in Jesus' name. Prepare my heart to hire the questions of life. Amen.

_May the old interrogators of your soul be found unemployed from today._$dev$),
  (3, 5, 'reading', 'Go Deeper', NULL, $dev$Romans 12:1–2; Philippians 4:8$dev$),
  (4, 1, 'scripture', 'Today''s Reading', 'Genesis 3:9', $dev$“But the Lord God called to the man, “Where are you?””$dev$),
  (4, 2, 'devotional', 'Devotional', NULL, $dev$The first question in the Bible is not asked by man to God, but by God to man — and hear its tone rightly. The all-knowing God was not requesting coordinates. Where are you? was a father's question, designed to draw a hiding son out of the bushes into honesty.

God's questions locate; they do not humiliate. To Elijah under the broom tree: “What are you doing here?” To the blind man: “What do you want me to do for you?” To Peter, thrice: “Do you love me?” Every one an open door dressed as an inquiry.

God may be asking you one of His questions right now. Do not answer it the way Adam did — with hiding and blame. Answer it in the open: here I am. Honest location is where every restoration begins.$dev$),
  (4, 3, 'talk', 'Talk it Over', NULL, $dev$— If God asked you “Where are you?” today — honestly — what is the answer?

— What question does He seem to be asking you in this season?$dev$),
  (4, 4, 'devotional', 'Pray', NULL, $dev$Father, here I am — no bushes, no blame. Ask me Your questions, and give me the honesty to answer from where I truly stand. Amen.

_May you step out of every bush and find that His voice was mercy all along._$dev$),
  (4, 5, 'reading', 'Go Deeper', NULL, $dev$Genesis 3:8–13; 1 Kings 19:9–13; John 21:15–17$dev$),
  (5, 1, 'scripture', 'Today''s Reading', 'Proverbs 20:5', $dev$“The purposes of a person’s heart are deep waters, but one who has insight draws them out.”$dev$),
  (5, 2, 'devotional', 'Devotional', NULL, $dev$It seems when people question, they don't go deep enough. They deliberately ignore the answers that will serve them — because the second answer usually costs something the first one does not.

Ask “what happened?” and you get a story. Ask “why did it happen?” and you get a pattern. Ask “what was my part in it?” and you get a mirror. Ask “what must I become so it does not happen again?” and you finally get a door. Most people stop at the story. The becoming ones keep drilling.

The best questions often lead to uncomfortable truths — embrace the discomfort, for it is the labor ward of growth. Deep waters do not surrender their treasure to a shallow bucket. Draw deep this week.$dev$),
  (5, 3, 'talk', 'Talk it Over', NULL, $dev$— Where did you recently stop at the first answer because the second would cost you?

— Take one recurring frustration: what is your part in it — honestly?$dev$),
  (5, 4, 'devotional', 'Pray', NULL, $dev$Father, give me a deeper bucket. I choose the uncomfortable second answer over the comfortable first one. Draw out of me what I have avoided knowing. Amen.

_May the deep waters of your heart yield treasure to your drawing this week._$dev$),
  (5, 5, 'reading', 'Go Deeper', NULL, $dev$Proverbs 20:5; Psalm 51:6; Haggai 1:5–7$dev$),
  (6, 1, 'scripture', 'Today''s Reading', '1 Samuel 17:26', $dev$“David asked the men standing near him, “…Who is this uncircumcised Philistine that he should defy the armies of the living God?””$dev$),
  (6, 2, 'devotional', 'Devotional', NULL, $dev$For forty days an entire army operated on one unexamined assumption: Goliath cannot be beaten. Nobody had voted on it; it had simply settled over the valley like weather. Then a shepherd boy arrived and asked a different question — not “how big is he?” but “who is he, to defy the armies of the living God?”

One question re-framed the entire battle. The giant did not change; the assumption did.

Many of our prisons have unlocked doors — held shut only by beliefs we never interrogate: there is only one option; people like me don't succeed; it is too late for this dream. Today, put your oldest assumption on trial. Ask it for its evidence. You may discover, as Israel did, that the thing which silenced you for forty days falls to a single well-aimed question.$dev$),
  (6, 3, 'talk', 'Talk it Over', NULL, $dev$— What “everyone knows” assumption has been governing your decisions?

— What question would David ask about your Goliath?$dev$),
  (6, 4, 'devotional', 'Pray', NULL, $dev$God of David, teach me to question the weather of assumptions. Where a lie has ruled unexamined, give me the one question that brings it down. Amen.

_May one brave question topple what forty days of fear could not._$dev$),
  (6, 5, 'reading', 'Go Deeper', NULL, $dev$1 Samuel 17:20–37; Numbers 13:30–33$dev$),
  (7, 1, 'scripture', 'Today''s Reading', 'James 1:5', $dev$“If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.”$dev$),
  (7, 2, 'devotional', 'Devotional', NULL, $dev$Here is a promise so generous we hardly believe it: God answers wisdom-requests without finding fault. He does not say, “You should know this by now.” He does not review your record. He gives — generously, to all who ask.

Solomon stood at the same door. Offered anything, he asked for a discerning heart — and God was so pleased with the question that He added everything Solomon had not asked for (1 Kings 3:10–13). Heaven rewards good asking.

Much of what we lack, we simply have not asked for (James 4:2). So make asking a discipline: before the meeting, the decision, the difficult conversation — “Father, wisdom.” Two words, prayed honestly, have redirected more lives than a thousand hours of worry.$dev$),
  (7, 3, 'talk', 'Talk it Over', NULL, $dev$— What decision are you currently carrying that you have worried about more than you have asked about?

— What would “asking first” look like as a daily habit?$dev$),
  (7, 4, 'devotional', 'Pray', NULL, $dev$Father, I lack wisdom and You love to give it. For every decision on my desk this week — wisdom. I ask in faith, expecting a generous answer. Amen.

_May generous wisdom arrive ahead of every decision you face this week._$dev$),
  (7, 5, 'reading', 'Go Deeper', NULL, $dev$James 1:2–8; 1 Kings 3:5–14$dev$),
  (8, 1, 'scripture', 'Today''s Reading', 'Psalm 25:4', $dev$“Show me your ways, Lord, teach me your paths.”$dev$),
  (8, 2, 'devotional', 'Devotional', NULL, $dev$A person of purpose should sit regularly before six great questions. Who am I? — the question of identity. Where did I come from? — the question of origin. Why am I here? — the question of purpose. What can I do? — the question of potential. Where am I going? — the question of destiny. What should I become? — the question of growth.

These are not questions you answer once; they are companions you walk with, and their answers deepen every season you ask them.

Notice something beautiful: this whole journey of plans is built on them. You have already sat with identity and origin; you are sitting with purpose now; potential and destiny are ahead. The examined life is not a philosopher's luxury — it is a disciple's habit.$dev$),
  (8, 3, 'talk', 'Talk it Over', NULL, $dev$— Which of the six questions have you never seriously sat with?

— Schedule it: when, this week, will you give that question an unhurried hour?$dev$),
  (8, 4, 'devotional', 'Pray', NULL, $dev$Lord, I take up the six great questions as lifelong companions. Show me Your ways, teach me Your paths, and answer me a little more deeply in every season. Amen.

_May the six great questions become six old friends who always lead you home._$dev$),
  (8, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 25:4–5, 12–14$dev$),
  (9, 1, 'scripture', 'Today''s Reading', 'Luke 11:8', $dev$“Because of your shameless audacity he will surely get up and give you as much as you need.”$dev$),
  (9, 2, 'devotional', 'Devotional', NULL, $dev$Jesus told of a man knocking on a friend's door at midnight — refused once, knocking still — and praised his shameless audacity. Then He gave the grammar of kingdom asking: ask, and keep asking; seek, and keep seeking; knock, and keep knocking — the verbs are continuous.

Some answers are on the other side of persistence, and heaven has reasons: persistence purifies the request (casual wishes fall away), enlarges the vessel (you grow while you knock), and times the answer to the season it belongs in.

Daniel prayed twenty-one days before the answer that had been dispatched on day one broke through. Do not let day twenty be the day you stop. The door is not deaf; it is testing your certainty that this request truly belongs to you.$dev$),
  (9, 3, 'talk', 'Talk it Over', NULL, $dev$— What request did you quietly stop knocking on — and was it fatigue or wisdom that stopped you?

— What is worth resuming with “shameless audacity” this week?$dev$),
  (9, 4, 'devotional', 'Pray', NULL, $dev$Father, renew my knuckles. For the request You planted in me, I resume asking, seeking, knocking — with the audacity of a man who knows whose door it is. Amen.

_May midnight doors open to your knocking this season._$dev$),
  (9, 5, 'reading', 'Go Deeper', NULL, $dev$Luke 11:5–13; 18:1–8; Daniel 10:12–13$dev$),
  (10, 1, 'scripture', 'Today''s Reading', 'Psalm 139:23–24', $dev$“Search me, God, and know my heart; test me and know my anxious thoughts. See if there is any offensive way in me, and lead me in the way everlasting.”$dev$),
  (10, 2, 'devotional', 'Devotional', NULL, $dev$The final upgrade is the bravest: turn the questioning over to God. David — the man who asked so many questions of life — ends his greatest psalm by handing God the interrogation: Search me. Test me. See. Lead.

This is the prayer of an open life: no locked rooms, no bushes to hide in, no defended blind spots. It is also the safest prayer in the world, because the Searcher is the same God whose thoughts toward you are precious and vast as sand (Psalm 139:17–18). He searches with a lamp, not a sword.

So here is your commissioning from these ten days: live examined. Ask better of yourself, ask boldly of God, and let God ask freely of you. The gate-opening question at Caesarea Philippi has a twin that never stops working: Lord — what do You say about me, and what are You asking of me now?$dev$),
  (10, 3, 'talk', 'Talk it Over', NULL, $dev$— Is there a room in your life you have kept off-limits to God's questions?

— What has this plan changed about the way you will ask — and be asked?$dev$),
  (10, 4, 'devotional', 'Pray', NULL, $dev$Search me, God, and know my heart; test me and know my anxious thoughts. See what I cannot see, say what I need to hear, and lead me in the way everlasting. Amen.

_May you live gladly examined — asked, answered, and led all your days._$dev$),
  (10, 5, 'reading', 'Go Deeper', NULL, $dev$Psalm 139; Hebrews 4:12–13$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
