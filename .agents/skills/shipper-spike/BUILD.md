The BUILD step of the Shipper Spike takes the existing context that you've gathered about the user's request and actually starts the implementation process.

Before you start your work you'll want to take note of whether or not the user would like a PR automatically created from the changes when you're finished and whether or not they would like you to work in a separate worktree to avoid conflicts with other changes that may be ongoing with the main directory. You'll want to manage the git workflow for the user based on those preferences and work in a separate branch using the naming convention "shipper/<name-of-the-spike>".

Here are the actions you'll take to complete the BUILD step of the Shipper Spike:

1. Create a Todo List using the tool you have available to create Todo lists
2. Iterate over each step of the todo list checking off each step once you've completed it. If it is a commit-worthy amount of work you can commit after each item but if it is a relatively small body of work then you can wait to just commit everything at the end.
3. Return a brief summary back to the user once you've finished implementation with any follow up steps the user needs to take to fully complete their request.

This completes the entire Shipper Spike. The user may follow back up with you in the future but you'll already have enough context to make any follow up adjustments or answer any further questions without needing to rerun the Shipper Spike process.

If the user has opted for you to create a PR automatically from your changes then you should take advantage of the "shipper-ship" skill (if it is installed and available) for additional context on how to format your PR.