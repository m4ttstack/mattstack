export const TOOL_DESCRIPTION =
  "Ask the person questions in a form pane and wait for their answers. No limit on how many questions or options. Takes questions in mattstack gate_ask shape ({id, label, multi, writeIn, context, options}); give every option a description, one short line on what picking it means. Returns at once; the person's answers arrive as your next input, keyed by question id in gate_answer's shape: a value for a single pick, an array for multi, text for a question with no options, {writeIn} or {value, note} for typed Other text."

export const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The form title, e.g. the gate kind.' },
    context: { type: 'string', description: 'Markdown shown above the questions, or a gate-ctx@1 JSON string.' },
    questions: {
      type: 'array',
      description: 'Questions in gate_ask shape. Any number of questions and options.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          header: { type: 'string', description: 'A short tab name, a word or two. Defaults to the id.' },
          label: { type: 'string' },
          multi: { type: 'boolean' },
          writeIn: { type: 'boolean', description: 'Marks a question whose Other text you can act on, as gate_ask does. Every question with options shows an Other row either way.' },
          context: { type: 'string' },
          options: {
            type: 'array',
            description: 'Objects {value, label, description}, each with a one-line description of what picking it means (a bare string is accepted but draws a blank line under it). Leave out for a free-text question.',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: { value: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } },
                  required: ['value'],
                },
              ],
            },
          },
        },
        required: ['id', 'label'],
      },
    },
  },
  required: ['questions'],
}
