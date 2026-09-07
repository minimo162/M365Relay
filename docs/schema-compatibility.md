# VS Code tool-schema compatibility fix (0.2.1)

## Confirmed incompatibility

The reported `unsupported_schema` happens after local HTTP authentication and before M365 inference.
The client stack identifies VS Code build prefix `520fb30b2d`. Its matching upstream commit is
`520fb30b2d3d324b4cb2342f6e88e2cd93751de1`. The built-in terminal tool declares
`properties.mode.enumDescriptions`, but M365Relay 0.2.0 rejects that annotation.

Source: https://github.com/microsoft/vscode/blob/520fb30b2d3d324b4cb2342f6e88e2cd93751de1/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts

The offending structure was reproduced locally against the unmodified 0.2.0 validator.
The exact user's HTTP request and selected tool set have NOT been captured, so this is a
confirmed incompatibility matching the error, not proof that it was the only unsupported definition.

## Change

Accept `enumDescriptions`, `markdownEnumDescriptions`, and `enumItemLabels` as display annotations
(string arrays). Preserve them verbatim in the M365 prompt. Continue enforcing `enum`, types, required
properties, and every previously supported constraint. Do not strip unknown validation keywords,
accept all schemas, or skip validation of returned tool arguments.

Unsupported definitions now identify the tool name or `response_format`, plus a known schema keyword.
Unknown key names are represented as `unknown_or_invalid`. No schema values, property names,
descriptions, defaults, examples, credentials or user prompts are added to the public error.
Log output remains metadata-only. Invalid schema shapes can still use the generic item label.

## Verification

The existing contracts and additional schema suite run on Linux and Windows in CI.
The separate Windows distribution smoke tests use the real bundled Node executable.

The new suite covers terminal-schema admission, preservation of the prompt, native tool-call
conversion, enum/type/required/additional-property enforcement, nested annotations, malformed
annotations, unsupported constraints, redacted diagnostics, response-format context, references,
and authenticated HTTP requests with a mock backend. It does not execute terminal commands.

Real VS Code + Edge + M365 end-to-end operation, corporate-PC acceptance, and the user's actual
tool set remain unverified. Do not call mock inference or public-source inspection a live pass.

## Update

Stop the previous bridge with Ctrl+C. Extract the complete new Windows distribution ZIP to a
separate directory and run its Start-Bridge.cmd. Keep the same M365_RELAY_HOME / M365_BRIDGE_HOME
value if customized. Retain the existing local settings, token and browser profile. No API-key
change or new Node installation is necessary. Do not edit src/schema.mjs in an already sealed bundle.

Temporary isolation: in Local / Agent, disable Run in Terminal and other optional tools, keep only
file reading/search/editing and start a fresh test chat. Removing tools reduces available execution
capabilities and is not a substitute for this compatibility fix.
