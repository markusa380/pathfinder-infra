from os import environ
import boto3

HOSTED_ZONE_NAME = environ['HOSTED_ZONE_NAME']
HOSTED_ZONE_ID = environ['HOSTED_ZONE_ID']
CLUSTER_ARN = environ['CLUSTER_ARN']
ARMA_SERVICE_NAME = environ['ARMA_SERVICE_NAME']
TEAMSPEAK_SERVICE_NAME = environ['TEAMSPEAK_SERVICE_NAME']

ecs = boto3.client("ecs")
r53 = boto3.client("route53")
ec2 = boto3.client('ec2')

def update_record(record_name: str, value: str):
  response = r53.change_resource_record_sets(
    HostedZoneId = HOSTED_ZONE_ID,
    ChangeBatch = {
        "Comment": "Automatic DNS update",
        "Changes": [
            {
                "Action": "UPSERT",
                "ResourceRecordSet": {
                    "Name": record_name,
                    "Type": "A",
                    "TTL": 60,
                    "ResourceRecords": [
                        {
                            "Value": value
                        },
                    ],
                }
            },
        ]
    }
  )

def get_current_ip(service: str):
  tasks_list = ecs.list_tasks(
    cluster = CLUSTER_ARN,
    serviceName = service
  )

  task_arns = tasks_list.get('taskArns')
  
  if not task_arns:
    return None

  task = task_arns[0]

  task_desc = ecs.describe_tasks(
    cluster = CLUSTER_ARN,
    tasks = [task]
  )

  details = task_desc.get('tasks')[0].get('attachments')[0].get('details')

  eni = [x for x in details if x.get('name') == "networkInterfaceId"][0].get('value')

  interfaces = ec2.describe_network_interfaces(
      NetworkInterfaceIds=[eni],
  )

  interface = interfaces['NetworkInterfaces'][0]

  return interface['Association']['PublicIp']

def main(event, context):
    print("Started update...")
    arma_ip = get_current_ip(ARMA_SERVICE_NAME)
    print("Current IP of Arma task is", arma_ip)
    if arma_ip is not None:
      update_record("arma." + HOSTED_ZONE_NAME, arma_ip)
      print("Updated record for Arma server")
    ts_ip = get_current_ip(TEAMSPEAK_SERVICE_NAME)
    print("Current IP of Teamspeak task is", ts_ip)
    if ts_ip is not None:
      update_record("ts." + HOSTED_ZONE_NAME, ts_ip)
      print("Updated record for Teamspeak server")