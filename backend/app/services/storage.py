import boto3
from botocore.client import Config as BotoConfig

from app.core.config import settings


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(signature_version="s3v4"),
    )


def upload_file(key: str, data: bytes, content_type: str) -> None:
    get_s3_client().put_object(
        Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type
    )


def download_file(key: str) -> bytes:
    response = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
    return response["Body"].read()


def delete_file(key: str) -> None:
    get_s3_client().delete_object(Bucket=settings.s3_bucket, Key=key)


def delete_prefix(prefix: str) -> int:
    """Delete every object under a key prefix; returns how many went.

    For files no row points at - generated images are keyed by their owner
    and kept in no table. A page of keys per delete call (S3 takes up to
    1000), so an account with a lot of pictures is a few requests rather
    than one per picture.
    """
    client = get_s3_client()
    deleted = 0
    for page in client.get_paginator("list_objects_v2").paginate(
        Bucket=settings.s3_bucket, Prefix=prefix
    ):
        keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        if keys:
            client.delete_objects(
                Bucket=settings.s3_bucket, Delete={"Objects": keys, "Quiet": True}
            )
            deleted += len(keys)
    return deleted
