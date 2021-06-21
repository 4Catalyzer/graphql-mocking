import {
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  getNamedType,
  isInterfaceType,
  isObjectType,
  isScalarType,
} from 'graphql';
import type { MockFieldResolver, MockGraphQLFieldResolver } from '.';
import { faker, getNullableNamedType } from './utils';
import { fromGlobalId, toGlobalId } from 'graphql-relay';

function isNodeInterface(intf: GraphQLInterfaceType) {
  if (intf.name !== 'Node') return false;
  const fields = intf.getFields();

  if ('id' in fields) {
    const idType = getNamedType(fields.id.type);
    return idType.name === 'ID' && isScalarType(idType);
  }
}

export function hasNodeInterface(schema: GraphQLSchema) {
  const nodeType = schema.getType('Node');
  return nodeType && isInterfaceType(nodeType) && isNodeInterface(nodeType);
}

export function implementsNode(v: GraphQLType) {
  if (!isObjectType(v)) return false;
  const interfaces = v.getInterfaces();
  return interfaces.some(isNodeInterface);
}

export function hasNodeQuery(queryType: GraphQLObjectType) {
  const nodeField = queryType.getFields().node;
  return nodeField && isInterfaceType(nodeField) && nodeField.name === 'Node';
}

export const globalIdMock: MockGraphQLFieldResolver = (
  src,
  _a,
  { mocks },
  info,
) => {
  const id = mocks.getId(src) || faker.datatype.uuid();
  const parent = getNullableNamedType(info.parentType);
  return implementsNode(parent) ? toGlobalId(parent.name, id) : id;
};

export const nodeField: MockFieldResolver = ({ id }, { mocks }) => {
  const resolvedId = fromGlobalId(id);
  return {
    ...mocks.get(resolvedId.type, resolvedId.id),
    __typename: resolvedId.type,
  };
};

export const nodeMock: MockGraphQLFieldResolver = (_, args, ctx, info) => {
  return nodeField(args, ctx, info);
};
