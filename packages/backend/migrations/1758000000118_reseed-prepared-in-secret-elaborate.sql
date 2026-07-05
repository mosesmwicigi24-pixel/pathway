-- Reseed prepared-in-secret with elaborate, well-structured YouVersion-style daily teaching.
-- Preserves the day arc (references + titles + Go Deeper); deepens the Devotional.
-- Re-runnable: days are cleanly reseeded (DELETE cascades to segments).

-- Up Migration
DELETE FROM reading_plan_days WHERE plan_id = (SELECT plan_id FROM reading_plans WHERE code = 'prepared-in-secret');
INSERT INTO reading_plan_days (plan_id, day_number, reference, title)
SELECT p.plan_id, v.n, v.ref, v.title FROM reading_plans p CROSS JOIN (VALUES
  (1, 'Luke 2:52', 'The Hidden Years of the Son of God'),
  (2, 'Isaiah 40:31', 'The Eagle Renews in Hiding'),
  (3, 'Luke 2:46', 'Found Among the Teachers, Asking Questions'),
  (4, 'Luke 14:28', 'Count the Cost, Build the Tower'),
  (5, 'Psalm 78:70–71', 'The Sheep Pens Before the Throne'),
  (6, 'Psalm 105:19', 'Joseph: Prepared by the Very Delay'),
  (7, 'Exodus 3:1', 'The Desert Curriculum'),
  (8, 'Esther 2:12', 'Esther''s Twelve Months of Oil'),
  (9, 'Ecclesiastes 9:11', 'Chance Favors the Prepared'),
  (10, 'Luke 16:12', 'Faithful in Another Man''s Vineyard')
) AS v(n, ref, title) WHERE p.code = 'prepared-in-secret';
INSERT INTO reading_plan_day_segments (plan_day_id, sort, kind, title, reference, content, video_url, image_url)
SELECT d.plan_day_id, v.sort, v.kind, v.title, v.ref, v.content, NULL, NULL
FROM reading_plan_days d
JOIN reading_plans p ON p.plan_id = d.plan_id AND p.code = 'prepared-in-secret'
JOIN (VALUES
  (1, 1, 'scripture',  'Today''s Reading', 'Luke 2:52', $dev$“And Jesus grew in wisdom and stature, and in favor with God and man.”$dev$),
  (1, 2, 'devotional', 'Devotional',       NULL,     $dev$The most important life ever lived was ninety percent hidden. Thirty years in Nazareth before three years of public ministry — and from age twelve, the Scripture goes almost entirely silent, summarizing eighteen years in a single verse: He grew. If the Son of God did not skip His hidden years, then hidden years cannot be a punishment. They must be a curriculum.

Look closely at what that curriculum contained. Nazareth was a nowhere town — “can anything good come from there?” a future disciple would sneer (John 1:46). Yet in that unremarkable place, at a carpenter''s bench, the Son of God practiced everything He would later preach. He honored His parents. He handled money. He served neighbors who never suspected who lived among them. He waited on the Father''s timing while carrying the greatest calling in history, entirely unannounced.

Here is the truth the impatient never learn: greatness is grown, not summoned. Luke measures it in three directions at once — wisdom (the mind), stature (the person), favor with God and man (the relationships). This is the exact file heaven kept on Jesus, and it is the file heaven is keeping on you. Hidden does not mean forgotten. For a long and holy stretch, hidden is simply what chosen looks like before the world is told.

So before anything else changes in your circumstances, let something change in your labeling. You have been writing “passed over” across this season. Cross it out. Write instead what the Father wrote over Nazareth: growing in wisdom, stature, and favor.

Hidden is not the opposite of chosen. It is often the first ten years of it.$dev$),
  (1, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What label have you quietly written across your hidden season — and what would it change to name it a curriculum instead?

— Of the three directions Luke names — wisdom, stature, favor with God and man — which is God growing in you right now?$dev$),
  (1, 4, 'devotional', 'Pray',             NULL,     $dev$Lord Jesus, You honored Your hidden years, so I will honor mine. Re-label my season with heaven''s own file: growing in wisdom, stature, and favor. Quiet my impatience and teach me to trust the making. Amen.

_May you carry your hidden season the way Jesus carried Nazareth — unhurried and unashamed._$dev$),
  (1, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 2:41–52; Philippians 2:5–11$dev$),
  (2, 1, 'scripture',  'Today''s Reading', 'Isaiah 40:31', $dev$“But those who hope in the Lord will renew their strength. They will soar on wings like eagles…”$dev$),
  (2, 2, 'devotional', 'Devotional',       NULL,     $dev$There is a season when the eagle — the king of the skies — vanishes from view. Feathers weathered, beak worn down, it retreats to the heights and endures a painful renewal: old plumage shed, worn beak worn away, new strength grown in. The bird that finally lifts off looks reborn, because in every sense that matters it is.

Isaiah drops this bird into the middle of a promise for exhausted people. His audience was worn out — a nation in captivity, quietly convinced that “my way is hidden from the Lord” and that their cause had slipped past His notice (v. 27). To the tired, God does not offer an easier road; He offers renewed strength for the road they are already on. And notice carefully how that renewal arrives: not in the flight, but in the waiting. “Those who hope in the Lord” — those who wait on Him — are the very ones who rise. The strength is real, but it is issued to the patient.

That reframes everything about your low-visibility stretch. The eagle does not molt in mid-air, and neither do you. Some renewals simply require withdrawal — seasons when God takes you off the stage not to shelve you, but to re-feather you. New strength. New sharpness. New wind under wings that had grown heavy. What looks like your sidelining may be your soaring being manufactured out of sight.

So before you panic over your shrinking platform, ask the honest question: is this rejection, or is this renewal? The two can feel identical from inside the molt. Stop fighting the withdrawal. Let God strip what is worn and grow what is new.

What rises out of this hiding will out-fly whatever entered it.$dev$),
  (2, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Could your reduced visibility right now be renewal rather than rejection — and what changes if you dare to believe it?

— What “old feathers” — outdated methods, props, dependencies, self-images — is God shedding from you in this season?$dev$),
  (2, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I stop fighting the hiding. Renew me in it — shed from me what is worn, grow in me what is new, and when You finally lift me, let me soar on wings that this season grew. I choose to wait on You. Amen.

_May you leave this hidden season wearing wings it grew for you._$dev$),
  (2, 5, 'reading',    'Go Deeper',        NULL,     $dev$Isaiah 40:27–31; Psalm 103:5$dev$),
  (3, 1, 'scripture',  'Today''s Reading', 'Luke 2:46', $dev$“After three days they found him in the temple courts, sitting among the teachers, listening to them and asking them questions.”$dev$),
  (3, 2, 'devotional', 'Devotional',       NULL,     $dev$We are given exactly one scene from the hidden years of Jesus, and it is worth staring at. He is twelve. His parents have lost Him in the crowded chaos of a festival and searched for three frantic days. And where do they finally find the Son of God? Not performing. Not teaching the teachers a lesson. Sitting among them — listening, and asking questions.

That posture is the whole secret. The posture of preparation is the posture of a learner. This one glimpse, at age twelve, is the last we hear until a fully prepared Man steps into the Jordan eighteen years later. The silence in between was not empty. It was study. The hidden years were learning years, and Jesus spent them the way the wise always do — leaning in, curious, unhurried, asking.

Here is where most people waste their obscurity: they spend the waiting room sulking instead of studying. They treat the delay as dead time to be endured rather than a classroom to be attended. But a hidden season is heaven''s tuition-free education, and the question is simply whether you will enroll. What is this season trying to teach you? The skill your next assignment will demand? The Scriptures you have skimmed but never mined? The patience, the craft, the language, the character that only quiet years can grow?

Sit among the teachers. Let books, mentors, and the Word be your temple courts. Come with a twelve-year-old''s humility — listening, asking, taking notes on your own life.

Then, when your Jordan moment finally comes, you will not scramble to be ready. You will simply step in, prepared.$dev$),
  (3, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What is this season trying to teach you that you have been too frustrated, or too proud, to actually sit down and learn?

— “Sit among the teachers”: which specific book, mentor, or study will you take up this month to make your waiting room a classroom?$dev$),
  (3, 4, 'devotional', 'Pray',             NULL,     $dev$Father, turn my waiting room into a classroom. Give me the twelve-year-old''s posture — listening, asking, learning — instead of the sulking of the impatient. Teach me here, quietly, until the Jordan calls my name. Amen.

_May your hidden years be found, later, to have been your best-attended school._$dev$),
  (3, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 2:41–52; Proverbs 4:5–9$dev$),
  (4, 1, 'scripture',  'Today''s Reading', 'Luke 14:28', $dev$“Suppose one of you wants to build a tower. Won’t you first sit down and estimate the cost to see if you have enough money to complete it?”$dev$),
  (4, 2, 'devotional', 'Devotional',       NULL,     $dev$Every unfinished building tells the same story about its builder: he started what he had not counted. A tower rising three stories and then stopping — roofless, exposed, mocked by the town — is not a monument to bad luck. It is a monument to poor arithmetic. Jesus knew we would rather not do the math.

He was speaking to crowds intoxicated by the excitement of following Him, and He deliberately cooled their enthusiasm with a picture: a builder, seated, counting the cost before laying a single stone. Notice the posture again — He sits down. Counting the cost is not a moment of doubt; it is an act of seriousness. It means honestly seeing whether you have what it takes to finish, and gathering it before you begin.

This is the hidden season''s great and secret privilege. Right now, unobserved, you can gather what your future assignment will one day spend. Character enough to survive promotion, so that the platform does not expose a hollow soul. Prayer depth enough to survive pressure, so that the crisis finds a well already dug. Skill enough to survive scrutiny, so that when the spotlight comes it finds competence, not bluff. Half-built towers advertise unprepared builders — and many of the public collapses we witness were simply private preparations that never happened.

So take the seat today. Sit down with your calling and count with brutal honesty: what will finishing this actually require that I do not yet possess? Do not flinch from the list. That list is not an indictment.

That list is your hidden season''s syllabus.$dev$),
  (4, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What will your calling''s “tower” require to finish that you honestly do not yet possess — in character, in skill, in depth?

— Turn that gap into a syllabus: name one thing on the list you can begin gathering, quietly, this season.$dev$),
  (4, 4, 'devotional', 'Pray',             NULL,     $dev$Master Builder, I sit down and count. Show me the true cost of the calling You have given me, and let this hidden season gather everything the finishing will one day spend. Save me from a half-built life. Amen.

_May your tower, when it rises, testify of the seasons you sat and counted._$dev$),
  (4, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 14:25–33; Proverbs 24:27$dev$),
  (5, 1, 'scripture',  'Today''s Reading', 'Psalm 78:70–71', $dev$“He chose David his servant and took him from the sheep pens; from tending the sheep he brought him to be the shepherd of his people Jacob.”$dev$),
  (5, 2, 'devotional', 'Devotional',       NULL,     $dev$When the prophet Samuel came to Jesse''s house to anoint a king, one son was not even invited to the lineup. The youngest was left out with the flock — so forgotten by his own father that Jesse did not think to send for him until Samuel insisted (1 Samuel 16:11). If your family has ever overlooked you in the day of selection, you are standing exactly where David stood.

But now hear the geography the Psalm records: God took him from the sheep pens. Heaven knew the address of the overlooked boy. While a household forgot him, the throne room had his coordinates. And the pens themselves were never wasted years — they were the palace''s classroom in disguise. Watching sheep taught David to watch people. Fighting lions and bears calibrated the courage that would one day face a giant. Long solitary nights with a harp composed the psalms a nation still prays three thousand years later. Same skills, larger flock. God was not stalling David''s destiny in the pasture; He was building it there.

Mark one more detail, because it may describe your exact frustration. Even after Samuel poured the oil over his head, David went back to the sheep. Anointed — and still hidden. The oil on his head and the wool still in his hands. Confirmed calling, unchanged circumstances.

If that is your season — you know you are called, and yet nothing on the surface has moved — you are in royal company. Tend what is in front of you with a whole heart. The God who knew the address of the sheep pens has not misplaced yours.$dev$),
  (5, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Where have you felt left out of the lineup — and can you trust that heaven knows your address even when the people nearest you forget it?

— What is your current “flock” quietly teaching you that your future “kingdom” will one day require?$dev$),
  (5, 4, 'devotional', 'Pray',             NULL,     $dev$Father, You take Your servants from sheep pens. I will tend what is before me with all my heart — anointed or overlooked, seen or unseen — until You come for me at the address You have always known. Amen.

_May the oil on your head keep you faithful with the wool in your hands._$dev$),
  (5, 5, 'reading',    'Go Deeper',        NULL,     $dev$1 Samuel 16:1–13; Psalm 78:70–72$dev$),
  (6, 1, 'scripture',  'Today''s Reading', 'Psalm 105:19', $dev$“Until the time came to fulfill his dreams, the Lord tested Joseph’s character.”$dev$),
  (6, 2, 'devotional', 'Devotional',       NULL,     $dev$Between the dream and the throne, Joseph fell for thirteen years. A favored son thrown into a pit by his brothers. A trusted steward framed and hurled into a dungeon. A dream-interpreter forgotten for two more years by the very man he had helped. Any honest observer, watching from the outside, would have concluded the dream had died — not once, but three separate times.

But read what heaven was doing in the same years, because Scripture insists on telling us: the word of the Lord tested him. And look closer at each station, because each one was secretly a school for the palace. Potiphar''s house taught Joseph how to run a great estate — budgets, staff, systems. The prison, of all places, taught him to administer people and manage complexity under pressure. Egypt''s future prime minister did his internship in a jail cell. The very delay was the preparation.

This is the thing about God that changes how you read your own setbacks: He wastes nothing. Not the betrayal. Not the false accusation. Not the forgotten favor, not even the two lost years while a cupbearer''s memory failed. Every one of those was tuition. And when the dream finally called Joseph''s name, he was ready in a single morning — shaved, dressed, and equal to a national crisis before lunch, because thirteen years had made him that man.

So look again at whatever feels like your dead-end today. That frustrating station is not a detour from your dream; it may be the very course your dream requires. Your delays are enrollments. Stop resenting the classroom. Attend the classes.$dev$),
  (6, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What is your current “station” — the job, the setback, the wait — secretly teaching you that your dream will one day require?

— Where has a delay tempted you to declare the dream dead, and how does Joseph''s story reframe it?$dev$),
  (6, 4, 'devotional', 'Pray',             NULL,     $dev$God of Joseph, I enroll in the classes of my delay. Test my character kindly, teach me in every station — the pit, the estate, the prison — and when the dream finally calls, find me ready in a single morning. Amen.

_May every dungeon in your story turn out to have been an internship for a palace._$dev$),
  (6, 5, 'reading',    'Go Deeper',        NULL,     $dev$Genesis 37, 39–41; Psalm 105:16–22$dev$),
  (7, 1, 'scripture',  'Today''s Reading', 'Exodus 3:1', $dev$“Now Moses was tending the flock of Jethro his father-in-law… and he led the flock to the far side of the wilderness…”$dev$),
  (7, 2, 'devotional', 'Devotional',       NULL,     $dev$Moses lived his life in three equal acts of forty years each. Forty years in Pharaoh''s palace, learning to be somebody. Forty years in the desert, learning to be nobody. And forty years showing the world what God can do with a man who has learned both. It is that middle stretch — the desert forty — that looks like pure, unredeemed waste. A prince reduced to a shepherd on the backside of nowhere, tending someone else''s sheep in obscurity.

But trace the geography of Exodus 3, and the waste dissolves. Moses leads the flock “to the far side of the wilderness” — to Horeb, the mountain of God. This is the same wilderness through which he will one day lead an entire nation. For forty years he has been unknowingly mapping his future mission field and calling it exile. The wells, the weather, the passes, the ways of the desert — every ordinary shepherding day was reconnaissance for a deliverance he could not yet imagine.

That is God''s method with His deliverers: He hides them in the very terrain of their coming assignment. And the burning bush appears not while Moses is searching for a sign, but while he is simply, faithfully, doing his job — tending the flock in front of him.

So look again at what feels like your exile. The organization frustrating you. The community you feel buried in. The problems you know far too well, down to their smallest detail. You may not be buried at all. You may be planted — placed, on purpose, in the exact soil of your assignment.

Stay faithful with the flock in your hands. The bush is closer than you think.$dev$),
  (7, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What “terrain” do you know intimately — an industry, a place, a struggle — that has felt like exile but could actually be reconnaissance for your assignment?

— Where might a burning bush be standing in your ordinary landscape, waiting for you to turn aside and look?$dev$),
  (7, 4, 'devotional', 'Pray',             NULL,     $dev$Father, re-map my wilderness. If this ground is my future mission field and not my grave, open my eyes to see it. And when the bush finally burns, find me faithful — tending the flock already in my hands. Amen.

_May the ground you called exile reveal itself as your appointed mission field._$dev$),
  (7, 5, 'reading',    'Go Deeper',        NULL,     $dev$Exodus 2:11–3:12; Acts 7:29–34$dev$),
  (8, 1, 'scripture',  'Today''s Reading', 'Esther 2:12', $dev$“Before a young woman’s turn came… she had to complete twelve months of beauty treatments prescribed for the women, six months with oil of myrrh and six with perfumes and cosmetics.”$dev$),
  (8, 2, 'devotional', 'Devotional',       NULL,     $dev$A full year of preparation for a single evening. Before any young woman went in to the king, she completed twelve months of oils and perfumes — six of myrrh, six of spices — prescribed, measured, and utterly unhurried. From the outside it must have felt absurd: a year of soaking for one appointment. But years later, when a whole nation''s survival hung on Esther''s access to that same throne, every hidden month of it mattered.

Notice what Esther did not do: she did not design her own preparation. She submitted to it. The regimen was prescribed; the calendar was not hers to shorten. And this is precisely where hidden seasons become hard, because they so often arrive with disciplines we would never have chosen. The humbling job. The small assignment. The long training. The closed door that keeps us soaking longer than our pride finds comfortable. We want the palace; we resent the myrrh.

But here is the order of things in God''s economy: the oil decides the readiness, and the calendar belongs to Him. You cannot rush the soaking and arrive prepared. The months are not a delay standing between you and your moment — they are the moment being made in advance.

And mark the destination, because it reframes all the waiting. The preparation was never ultimately about the palace''s luxury. It was about a single decisive hour — “for such a time as this” (Esther 4:14). Somewhere ahead of you sits your such-a-time, a moment only a prepared person could seize.

The soaking you resent today is the composure you will reign with then.$dev$),
  (8, 3, 'talk',       'Talk it Over',     NULL,     $dev$— What prescribed “oil” — a discipline, a training, a season of waiting — are you soaking in reluctantly right now?

— How does the promise of a coming “such a time as this” change the way you carry today''s slow preparation?$dev$),
  (8, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I submit to the oil. Prescribe my preparation, set my calendar, and hold me steady through the months I would rather skip. When my such-a-time finally comes, let a year of hidden soaking speak in one decisive moment. Amen.

_May every month of oil be found, at your decisive moment, to have been exactly enough._$dev$),
  (8, 5, 'reading',    'Go Deeper',        NULL,     $dev$Esther 2:8–17; 4:12–16$dev$),
  (9, 1, 'scripture',  'Today''s Reading', 'Ecclesiastes 9:11', $dev$“The race is not to the swift or the battle to the strong… but time and chance happen to them all.”$dev$),
  (9, 2, 'devotional', 'Devotional',       NULL,     $dev$The Preacher of Ecclesiastes noticed the same uncomfortable thing we all eventually notice: outcomes do not reliably follow talent. The swift lose races. The strong lose battles. The wise go hungry and the skilled go unnoticed — because “time and chance happen to them all.” Opportunity, in other words, arrives on a schedule no one controls. Doors swing open unannounced, and they swing shut the same way.

At first this sounds like a counsel of despair, but read it again and it becomes a strategy. If opportunities cannot be scheduled, then they can only be prepared for. You cannot manufacture the open door. You can absolutely decide who is standing there when it opens. The scientist Louis Pasteur said it plainly in the laboratory — chance favors the prepared mind — but Scripture had staged the lesson centuries earlier in a prison cell.

Joseph could not have arranged for Pharaoh to dream. He could not have scheduled the cupbearer''s memory to return on the very morning the palace needed an interpreter. What he could do — and did — was spend thirteen obscure years becoming the man who could read the dream when the summons finally came. The opportunity arrived suddenly; his readiness had been built slowly. When the door opened, it found him already qualified to walk through it.

That is the whole burden of a hidden season, and its whole hope. You do not control the timing of your door. You entirely control who is standing there when it opens.

So prepare as though the knock were coming tonight — because time and chance are already on their way to your address.$dev$),
  (9, 3, 'talk',       'Talk it Over',     NULL,     $dev$— If the biggest door of your life swung open tonight, what part of you would be caught unready?

— What is one thing you will do this month so that when the knock comes, it finds you already standing and prepared?$dev$),
  (9, 4, 'devotional', 'Pray',             NULL,     $dev$Lord of times and seasons, I cannot schedule my door, so I will prepare for it. Build in me, slowly and surely, the readiness that sudden moments reveal. Find me qualified when opportunity finally knocks. Amen.

_May every sudden door of your life find you already dressed._$dev$),
  (9, 5, 'reading',    'Go Deeper',        NULL,     $dev$Ecclesiastes 9:10–11; Genesis 41:14–40$dev$),
  (10, 1, 'scripture',  'Today''s Reading', 'Luke 16:12', $dev$“And if you have not been trustworthy with someone else’s property, who will give you property of your own?”$dev$),
  (10, 2, 'devotional', 'Devotional',       NULL,     $dev$Here is the hidden season''s final exam, and it is not taken once — it is taken daily, in a hundred unglamorous moments. The question is simply this: how do you treat what belongs to someone else? Another leader''s vision. Another company''s growth. Another ministry''s platform. The wages, the credit, the applause all flow to a name that is not yours.

Jesus makes the principle unmistakable: your own comes only to those who have proven trustworthy with another''s. And Scripture is full of men who passed this exam in obscurity before they were ever handed anything of their own. Elisha poured water on Elijah''s hands for years — a servant''s task, invisible and unthanked — and inherited a double portion of the same spirit. Joshua carried the tent duties and errands of Moses, standing in another man''s shadow, and inherited the crossing into the Promised Land. The men who eventually received the mantles were, without exception, the men who had first carried someone else''s luggage without bitterness.

This is where so many hidden seasons quietly fail. Not in dramatic sin, but in half-hearted service — doing another''s work with resentment, withholding excellence because the reward is not yours, waiting to be great until it is finally about you.

So close these ten days with the commissioning of the hidden: serve your present assignment as though it were the dream itself — because in God''s ledger, it already is. Be the armor-bearer who makes another king great. The world is far too busy to stand and admire your faithfulness.

But heaven is not too busy. It is watching, recording, and even now preparing a vineyard of your own.$dev$),
  (10, 3, 'talk',       'Talk it Over',     NULL,     $dev$— Whose “vineyard” are you serving right now — and how much of your heart are you actually giving to work that is not yet your own?

— What would wholehearted, excellent service look like this week — the same whether applause comes or never comes?$dev$),
  (10, 4, 'devotional', 'Pray',             NULL,     $dev$Father, I take up the towel in another man''s vineyard with joy, not resentment. Find me trustworthy with what belongs to someone else — faithful, excellent, unbitter — and in Your perfect time, hand me what is mine. Amen.

_May your faithfulness in another''s vineyard be answered with a harvest in your own._$dev$),
  (10, 5, 'reading',    'Go Deeper',        NULL,     $dev$Luke 16:10–12; 2 Kings 2:1–14$dev$)
) AS v(n, sort, kind, title, ref, content) ON v.n = d.day_number;

-- Down Migration
SELECT 1;
