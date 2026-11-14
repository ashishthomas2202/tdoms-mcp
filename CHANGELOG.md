# Changelog

## 0.10.2

- Fix linking a task to a tracker issue. `link-task-to-issue`, `link-issue-to-task`, `unlink-task-from-issue`, `tdoms_task_link_ticket`, and `tdoms_task_unlink_ticket` now post the TD/OMS link request fields (`freeFormatProductId`, `urlToItem`, `urlToProduct`, `universalUniqueId`, `disableIndicator`, `remoteIssueInformation`) instead of the read-side names, which TD/OMS rejected with "The product Id may not be blank." The plan defaults the product id and issue URL form from the application's existing links, checks for an existing link first, and refuses to post with a blank product id or issue URL.
- Fix `tdoms_task_tickets`, `tdoms_task_backlinks`, `tdoms_task_requests`, `tdoms_task_details`, and the `trackerLinks` option set, which queried a table or task field that TD/OMS does not have. They now read `OMXRequestTaskLink` by `taskNumber`.

## 0.10.1

- Fix the command entry so npm keeps the `tdoms-mcp` command.
