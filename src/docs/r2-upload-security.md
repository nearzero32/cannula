# R2 managed-upload deployment controls

Cannula treats R2 as optional infrastructure: the rest of the API may start without it, while upload routes return a safe `503`. Production URLs must use HTTPS. `R2_BUCKET_NAME` is the public-image bucket; `R2_PRIVATE_BUCKET_NAME` is a separate bucket with no public/custom-domain exposure and contains all pending uploads and prescription images. Credentials need Object Read and Write for only these two application buckets; account administration is not required.

## Bucket lifecycle

Configure an R2 lifecycle rule that deletes objects with prefix `pending/` after one day. Mongo TTL removes abandoned intent records, but cannot delete bucket objects. Valid objects are copied to `public/` or `private/` and removed from `pending/` during completion.

## CORS

Allow only the deployed dashboard and mobile-web origins. Permit `PUT`, the `Content-Type` request header, and expose `ETag`. Do not enable credentials and do not use a wildcard origin for authenticated browser deployments. Backend `GET`, `HEAD`, `COPY`, and `DELETE` operations do not require browser CORS.

## Enforcement reality

R2 presigned PUT does not provide an S3 POST `content-length-range` policy. Cannula signs the expected content type, but the authoritative controls occur at completion: `HEAD` validates actual length and metadata, a bounded range read validates format and dimensions, and rejected pending objects are deleted. Public URLs are emitted only after promotion. Private prescription images are delivered with five-minute signed GET URLs after authorization.

## Residual operations

Monitor failed cleanup warnings and periodically reconcile old unattached READY assets. No bucket-wide list or client-supplied delete key is used by the API.
