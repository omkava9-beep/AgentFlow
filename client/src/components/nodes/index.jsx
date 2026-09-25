import BaseNode from './BaseNode';

export const nodeTypes = {
  start: (props) => <BaseNode {...props} type="start" showTarget={false} />,
  end: (props) => <BaseNode {...props} type="end" showSource={false} />,
  agent: (props) => <BaseNode {...props} type="agent" errorHandle />,
  tool: (props) => <BaseNode {...props} type="tool" errorHandle />,
  condition: (props) => (
    <BaseNode
      {...props}
      type="condition"
      sourceHandles={[
        { id: 'true', style: { top: '35%' } },
        { id: 'false', style: { top: '65%' } },
      ]}
    />
  ),
  // spec/31 advanced nodes. Loop, sub-workflow and code get an error handle;
  // transform, delay and merge are orchestration that can't "fail" usefully.
  transform: (props) => <BaseNode {...props} type="transform" />,
  code: (props) => <BaseNode {...props} type="code" errorHandle />,
  delay: (props) => <BaseNode {...props} type="delay" />,
  loop: (props) => <BaseNode {...props} type="loop" errorHandle />,
  merge: (props) => <BaseNode {...props} type="merge" />,
  subworkflow: (props) => <BaseNode {...props} type="subworkflow" errorHandle />,
  // spec/32: approved (green) and rejected (red) branches, like a condition.
  approval: (props) => (
    <BaseNode
      {...props}
      type="approval"
      sourceHandles={[
        { id: 'approved', style: { top: '35%', background: '#22c55e', borderColor: '#22c55e' }, title: 'Approved' },
        { id: 'rejected', style: { top: '65%', background: '#ef4444', borderColor: '#ef4444' }, title: 'Rejected' },
      ]}
    />
  ),
};
