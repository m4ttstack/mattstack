import { inputField } from '../widgets/input-field'
import { kitComponent } from './core'

// `width` defaults to the Panel's; the cursor shows while the surface is focused unless `cursor` says otherwise.
export type InputFieldProps = { value: string; placeholder?: string; width?: number; cursor?: boolean }

export const InputField = kitComponent('InputField', (props: InputFieldProps, ctx) => [inputField(props.value, props.placeholder ?? '', props.width ?? ctx.width, props.cursor ?? ctx.focused)])
