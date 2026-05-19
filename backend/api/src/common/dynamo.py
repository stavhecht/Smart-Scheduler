import os
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Key


def _to_dynamo(value: Any) -> Any:
    """Recursively convert floats → Decimal and datetimes → ISO string."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_dynamo(i) for i in value]
    return value


class DynamoClient:
    def __init__(self) -> None:
        name = os.environ.get("TABLE_NAME", "SmartScheduler_V1")
        self.table = boto3.resource("dynamodb", region_name="us-east-1").Table(name)

    def put(self, pk: str, sk: str, data: dict) -> None:
        item = _to_dynamo({**data, "PK": pk, "SK": sk})
        self.table.put_item(Item=item)

    def get(self, pk: str, sk: str) -> Optional[dict]:
        return self.table.get_item(Key={"PK": pk, "SK": sk}).get("Item")

    def delete(self, pk: str, sk: str) -> None:
        self.table.delete_item(Key={"PK": pk, "SK": sk})

    def query_prefix(self, pk: str, sk_prefix: str) -> List[dict]:
        return self.table.query(
            KeyConditionExpression=Key("PK").eq(pk) & Key("SK").begins_with(sk_prefix)
        ).get("Items", [])

    def scan(self, **kwargs) -> List[dict]:
        items: List[dict] = []
        while True:
            resp = self.table.scan(**kwargs)
            items.extend(resp.get("Items", []))
            if not (last := resp.get("LastEvaluatedKey")):
                break
            kwargs["ExclusiveStartKey"] = last
        return items


_client: Optional[DynamoClient] = None


def get_db() -> DynamoClient:
    global _client
    if _client is None:
        _client = DynamoClient()
    return _client
