// get reference to S3 client
var async = require('async');
var AWS = require('aws-sdk');
var path = require('path');
var makePdfThumbnail = require('./process.js');
var util = require('util');
var tmp = require('tmp');
var fs = require('fs');

// get reference to S3 client
var s3 = new AWS.S3();

/* This function creates a thumbnail from a pdf.
 * The source bucket and key, and destiny bucket and key must be specified of s3 must be specified.
 */
exports.handler = function(event, context, callback) {
    // Read options from the event.
    console.log("Reading options from event:\n", util.inspect(event, {
        depth: 5
    }));
    var srcBucket = event.Records[0].s3.bucket.name;
    // Object key may have spaces or unicode non-ASCII characters.
    var srcKey =
        decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    var dstBucket = srcBucket + "resized";
    var dstKey = "pdfthumbnail-" + srcKey + ".png";

    // Sanity check: validate that source and destination are different buckets.
    if (srcBucket == dstBucket) {
        console.log("Source and destination buckets are the same.");
        return;
    }

    // Infer the image type.
    var typeMatch = srcKey.match(/\.([^.]*)$/);
    if (!typeMatch) {
        console.error(
            'Unable to infer document type for key ' + srcKey
        );
        return;
    }

    var imageType = typeMatch[1];
    if (imageType !== 'pdf') {
        console.error(
            'Skipping non-pdf ' + srcKey
        );
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function downloadAndTransform(next) {
            var request = s3.getObject({
                Bucket: srcBucket,
                Key: srcKey
            });

            try {
                var pdfStream = request.createReadStream();
            } catch (e) {
                return next(e);
            }
            tmp.file(function(err, path) {
                if (err) {
                    next(err);
                    return;
                }

                makePdfThumbnail.fromStreamToFile(pdfStream, path, resolution, function(err, tmpfilename) {
                    if (err) {
                        next(err);
                        return;
                    }
                    next(null, 'image/png', tmpfilename);
                });
            });
        },
        function upload(contentType, tmpfilename, next) {
            // Stream the transformed image to a different S3 bucket.
            var tmpFileStream = fs.createReadStream(tmpfilename);
            s3.upload({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: tmpFileStream,
                    ContentType: contentType
                },
                next);
        }
    ], function(err, keys) {
        if (err) {
            console.error(
                'Unable to resize ' + srcKey + ' from ' + srcBucket +
                ' and upload to ' + dstBucket + '/' +
                ' due to an error: ' + util.inspect(err, {
                    showHidden: false,
                    depth: null
                })
            );
        } else {
            for (var i = 0; i < keys.length; i++) {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + keys[i]
                );
            }
        }
    });
};
