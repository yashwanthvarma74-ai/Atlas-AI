# Atlas AI: building a private knowledge copilot, and measuring it honestly

Atlas AI lets people upload documents into a private workspace, ask questions, and get streamed answers whose
citations open the exact page they came from. This is the story of the decisions behind it, including the numbers that
came out worse than I wanted.

## The problem and the constraints

A retrieval-augmented assistant is easy to demo and hard to trust. Three things decide whether it is trustworthy, and
each one needs evidence rather than a good-looking demo. Does retrieval find the right passage? Can one customer's
text ever reach another's answer? Can the model be made to do something the user did not ask for?

I set three constraints early. The search filter for a workspace would be added by server code, never by the model or
the request. A citation would be something the model can point at but cannot invent. And every quality claim would
come from a benchmark that anyone could re-run.

## Options I weighed

For vectors I chose MongoDB Atlas Vector Search over a dedicated vector database, so passages, vectors and the
tenant filter live in one store and there is nothing to keep in sync. For streaming I chose Server-Sent Events over
WebSockets, because words only flow one way. I wrote the retrieval and the stream reader by hand instead of using a
framework, so latency, cost and failure can be traced line by line.

## What I chose, and the trade-off I accepted

**Tenant isolation as a type.** Every function that touches a workspace's data takes a `WorkspaceAccess`, and only
`requireAccess` can produce one. A route that forgets the check does not compile. The cost is one extra indexed
read per request. In retrieval the workspace filter sits inside both the vector and the keyword search, and a document
filter can only narrow it.

**Hybrid search.** A vector search finds passages close in meaning, a keyword search finds exact names and codes, and
reciprocal rank fusion merges them without needing their scores to be comparable.

**Server-owned citations.** The model sees `[S1]` and the text, never a file name or a page. Numbers it was not given
are removed from its answer. I accepted that this checks a citation exists, not that it supports the sentence.

**The assistant proposes, a person approves.** Tool calls are requests written in the model's output. They are checked
twice, shown with their exact arguments, run once, and only by the conversation's author, with the role checked again
at that moment.

## The bugs that surprised me

Testing the isolation suite taught me the most. My first suite passed, and when I deleted the workspace filter from
the keyword search it still passed, because a later lookup repeated the filter and quietly dropped the leaked
chunks. Defence in depth had hidden the failure of the layer above it. I exported each search stage and attacked them
one at a time, and then every deliberate break failed a named test.

Running the real stack found the other one. The API and the worker both start up, both find no search indexes, and
both create them. The slower one is told the name is taken, and my code read any error as "this database cannot
search" and switched search off for the life of the process. Two replicas starting together would have done that every
time. Creating an index that already exists now counts as success, and search availability is re-checked.

## The numbers, including the miss

On a benchmark of 276 generated questions, recall@10 started at 71.7%. A sweep over chunk size, overlap and reranker
moved it to about 89%, and MRR from 0.37 to 0.63. The target was 0.90, so it is **not met**, and the dashboard says so.

I did not take the best-scoring setting. A 32-token chunk scored 94% but is a single sentence, which suits generated
one-sentence facts and would starve real documents of context. I picked the smallest size that holds the longest answer
sentence and a neighbour, which is 64.

I also tried a relevance cutoff and it does not work. An unanswerable question here differs from an answerable one by a
single entity, which similarity cannot see, and every threshold that rejected anything cost more recall than it was
worth. Whether the documents contain an answer has to be the model's call, and I cannot measure that without one.

Under load on a laptop, search sustained about 976 requests a second with a p95 of 63 ms at 50 in flight, and chat about
523, with no errors. Those use offline stand-ins for the embedder and the model, so they measure the system's own work and
nothing about a real model.

## What I would change at ten times the scale

Search is the first thing to hurt: two queries and an embedding per question, and an index that syncs a moment behind
writes. I would cache embeddings of repeated questions, and move uploads to object storage so the API and worker can run on
different machines. At a hundred times, the single approval-per-request flow and the per-conversation answer slot
become a design question rather than a tuning one. The evaluation would need real documents and a real model first, because
everything above is measured against stand-ins.

## What is not done

Nothing is deployed and there is no recorded demo. The hosted model providers have never run against their live services.
The benchmark is generated, so it says how retrieval behaves on near-identical sentences, not on messy real documents.
