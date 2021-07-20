import {
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  getNamedType,
  getNullableType,
  isInterfaceType,
  isListType,
  isObjectType,
  isScalarType,
} from 'graphql';
import { fromGlobalId, toGlobalId } from 'graphql-relay';

import type { MockFieldResolver, MockGraphQLFieldResolver } from '.';
import { uuid } from './mocks';
import { getNullableNamedType } from './utils';

function isNodeInterface(intf: GraphQLInterfaceType) {
  if (intf.name !== 'Node') return false;
  const fields = intf.getFields();

  if ('id' in fields) {
    const idType = getNamedType(fields.id.type);
    return idType.name === 'ID' && isScalarType(idType);
  }
  return false;
}

export const getIdInfo = (id: string) => {
  const parts = fromGlobalId(id);
  return toGlobalId(parts.type, parts.id) === id ? parts : null;
};

export const resolveLocalOrGlobalId = (id: string) => {
  const parts = fromGlobalId(id);
  if (toGlobalId(parts.type, parts.id) === id) return parts.id;
  return id;
};

export function hasNodeInterface(schema: GraphQLSchema) {
  const nodeType = schema.getType('Node');
  return nodeType && isInterfaceType(nodeType) && isNodeInterface(nodeType);
}

export function implementsNode(v: GraphQLType) {
  if (!isObjectType(v)) return false;
  const interfaces = v.getInterfaces();
  return interfaces.some(isNodeInterface);
}

export function isConnectionType(v: GraphQLType): v is GraphQLObjectType {
  if (!isObjectType(v)) return false;

  const { edges, pageInfo } = v.getFields();
  return (
    isListType(getNullableType(edges?.type)) &&
    isObjectType(getNullableType(pageInfo?.type))
  );
}

export function getConnectionNodeType(
  connection: GraphQLObjectType,
): GraphQLObjectType {
  const { edges } = connection.getFields();

  const edgeType = getNullableNamedType(edges!.type) as GraphQLObjectType;
  return getNullableNamedType(
    edgeType.getFields().node!.type,
  ) as GraphQLObjectType;
}

export function hasNodeQuery(queryType: GraphQLObjectType) {
  const nodeField = queryType.getFields().node;
  return (
    nodeField && isInterfaceType(nodeField.type) && nodeField.name === 'Node'
  );
}

export const globalIdMock: MockGraphQLFieldResolver = (
  src,
  args,
  ctx,
  info,
) => {
  const id = ctx.mocks.getId(src) || uuid(src, args, ctx, info);
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

export const nodeMock: MockGraphQLFieldResolver = (_, { id }, { mocks }) => {
  const resolvedId = fromGlobalId(id);
  return {
    ...mocks.get(resolvedId.type, resolvedId.id),
    __typename: resolvedId.type,
  };
};
