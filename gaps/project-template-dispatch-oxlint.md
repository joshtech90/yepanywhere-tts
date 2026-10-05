# Oxlint misidentifies the project-template mutation request as GET

Touched-file Oxlint reports:

`packages/server/src/app.ts:1027:13: unicorn(no-invalid-fetch-options): "body" is not allowed when method is "GET"`.

The diagnostic also occurs on the pre-change source. The
`createProjectTemplateRoutes` dispatch contract in
`packages/server/src/routes/project-templates.ts` accepts only POST or PUT;
the application callback defaults to POST and passes that method to Request.
GET is outside that contract. Biome lint and TypeScript accept the code.

This remains separate from public-link ownership and app-table work because
changing mutation dispatch behavior to evade a conservative lint diagnostic
would hide the diagnostic without fixing its owner. Reproduce against the
installed Oxlint, then fix its method analysis or justify a narrowly scoped
exception from the explicit POST/PUT contract. No warning filter was added.

Found 2026-10-01 while validating public-link replacement and app tables.
Contributing-model: 6.1-Sol
