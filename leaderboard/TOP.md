- what happens when we select multiple paper accounts?
- more educational tooltips for various stats

- If we’re progressively updating players then won’t snapshots be weird? Or can we only update some values all at once or in blocks? Maybe that’s some of the issue with over writes? Updating one by one and cron updating? What is getting cron updated and what is getting updated in the queue?

- Every 30 days we start over? Otherwise newcomers will struggle to compete. I see a filter by days, how does that work in practice?

---

- review logging and error reporting and ensure it's good across both stacks
- Codex, Kimi and Claude deep research, audit and improvements after documents and cross references
- Add a Me link where you can easily find yourself in the list
- Add a "Find Me" in the leaderboard which will load you in context with appropriate pagination positioning. May require we add pagination functionality for the leaderboard if we haven't already. should only be showing the top 100 by default but if you are say 845 it should paginate to that position and show you in that context
- need some sort of simple account system so folks can update or remove their connection (change username, update github, close or remove their account, etc.) This will also make the Me link much easier and more intuitive. Use open and available services for this. Cloudflare likely has a solution for this, maybe a plugin or package. Do some deep mcp research to find a simple opensource tool for easily managing users with this. likely just username and password but passkey would also be really nice or social login though I don't want to stand up a bunch of my own oauth apps and accounts with a bunch of services, nor do I want to pay anything for this.