import TransformPanel from './TransformPanel';
import CodePanel from './CodePanel';
import DelayPanel from './DelayPanel';
import LoopPanel from './LoopPanel';
import MergePanel from './MergePanel';
import SubworkflowPanel from './SubworkflowPanel';
import ApprovalPanel from './ApprovalPanel';

/** spec/31 node type → its config panel (rendered by NodeConfigPanel). */
export const ADVANCED_PANELS = {
  transform: TransformPanel,
  code: CodePanel,
  delay: DelayPanel,
  loop: LoopPanel,
  merge: MergePanel,
  subworkflow: SubworkflowPanel,
  // spec/32.
  approval: ApprovalPanel,
};
