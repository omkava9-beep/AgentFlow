import BaseNode from './BaseNode';

export const nodeTypes = {
  start: (props) => <BaseNode {...props} type="start" showTarget={false} />,
  end: (props) => <BaseNode {...props} type="end" showSource={false} />,
  agent: (props) => <BaseNode {...props} type="agent" />,
  tool: (props) => <BaseNode {...props} type="tool" />,
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
};
