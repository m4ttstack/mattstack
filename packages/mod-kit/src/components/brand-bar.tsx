import { brandBar } from '../widgets/brand-bar'
import { kitComponent } from './core'

export type BrandBarProps = { title: string; onHide?: () => void }

export const BrandBar = kitComponent('BrandBar', (props: BrandBarProps, ctx) => [brandBar(props.title, ctx.width, props.onHide && ctx.bind('hide', props.onHide))])
